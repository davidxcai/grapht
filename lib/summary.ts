import "server-only";

import { GoogleGenAI } from "@google/genai";

import { concernLabel } from "@/lib/concerns";
import { metricChanges, logRecord } from "@/lib/trial-detail";
import { baselineNames, interventionLabel, type Trial } from "@/lib/trials";

/**
 * The narrative layer of a finished trial, written by Gemini on the owner's
 * request (docs/app-ui.md §6). The LLM here is Gemini, not Claude — the same
 * deliberate choice as `src/product-targets.mjs`, and the same key.
 *
 * **The gate is upstream of the model, not inside it.** A metric that moved
 * less than the camera's wobble reaches the prompt as "no measurable change",
 * with no delta and no direction — the model cannot narrate a number it was
 * never given. Synthetic fixture concerns never reach it at all.
 */

const MODEL = "gemini-3.6-flash";

const SYSTEM = `You write the closing summary of a public, standardized skincare trial hosted on Grapht. The summary is a public record viewed by the community.

Rules, all hard:
- Third-person perspective ONLY. Never address the reader or user as "you", "your", or "I". Refer to "the trial", "the routine", or "the skin analysis" and make it read like a clear, friendly summary card on a community review feed.
- Explain the outcomes with universal, everyday language. Avoid academic/clincal jargon.
- Report strictly what the measurements state.
- Frame flat/unchanged scores naturally: "skin stayed steady", "rested in its normal range". NEVER blame camera resolution, instrument error, or hardware limits.
- Accurately reflect the Trial Type: if testing a core routine (Baseline Benchmark), state that the active background stack was evaluated directly.
- Never speculate on causality beyond noting which tracked product targets a specific metric.
- Never project forward or invent numbers, percentages, or timeframes.
- Warm, objective, and authoritative. Avoid clinical trial jargon ("subject", "regimen", "compliance"). Avoid the word "delta".
- Two short paragraphs, no headings, no bullet lists.`;

export interface SummaryResult {
    text: string;
    model: string;
}

function gateLine(metric: ReturnType<typeof metricChanges>[number]): string {
    const label = concernLabel(metric.concern);
    const role = metric.tracked
        ? "tracked"
        : metric.confounded
          ? "covered by the background routine, so a change here cannot be credited to the tracked product"
          : "untracked";
    if (metric.direction === "flat")
        return `- ${label} (${role}): no measurable change`;
    const verb = metric.direction === "improved" ? "improved" : "worsened";
    return `- ${label} (${role}): ${verb}, score ${Math.round(metric.first)} → ${Math.round(metric.latest)}`;
}

/**
 * Everything the model may know, assembled gate-first. Exported so the Summary
 * tab could show its own working if that is ever wanted.
 */
export function summaryInput(trial: Trial): string {
    const record = logRecord(trial);
    const metrics = metricChanges(trial).filter((m) => !m.synthetic);
    const products = trial.routine.interventions.map(
        (i) =>
            `${interventionLabel(i)}${i.dosage ? ` (${i.dosage} per use)` : ""}`,
    );
    const baseline = baselineNames(trial);

    return [
        `Trial: ${trial.name}`,
        `Window: ${trial.window.startDate} to ${trial.window.endDate ?? "open-ended"}, ended by the user.`,
        `Days with a photo logged: ${record.daysLogged}.`,
        `Change being tested: ${products.join("; ") || "a removal — nothing added"}.`,
        baseline.length > 0
            ? `Background routine, acknowledged but never credited: ${baseline.join(", ")}.`
            : "No background routine was declared.",
        "",
        'Measurements, day 1 to final photo. "No measurable change" means the movement was within the camera\'s own wobble and no direction may be stated:',
        ...metrics.map(gateLine),
    ].join("\n");
}

export async function writeSummary(trial: Trial): Promise<SummaryResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error(
            "GEMINI_API_KEY is not set, so the summary cannot be written.",
        );
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: MODEL,
        contents: summaryInput(trial),
        config: { systemInstruction: SYSTEM, temperature: 0.4 },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("the model returned an empty summary");
    return { text, model: MODEL };
}
