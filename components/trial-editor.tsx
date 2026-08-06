"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ImageUp, Loader2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ConcernChips } from "@/components/concern-chips";
import { ConcernPicker } from "@/components/concern-picker";
import { MultiSelect } from "@/components/multi-select";
import { orderConcerns } from "@/lib/concerns";
import { cn } from "@/lib/utils";
import { suggestConcerns, type Suggestion } from "@/app/routines/actions";
import { startTrial } from "@/app/trials/actions";
import type { Provenance, RankedConcern } from "@/lib/routines";
import type { Frequency } from "@/lib/trials";

export interface RoutineOption {
    id: string;
    name: string;
    coverage: string[];
    products: string[];
}

interface Draft {
    key: string;
    brand: string;
    name: string;
    targets: string[];
    ranked: RankedConcern[];
    classifier: { model: string; promptVersion: string } | null;
    productKey: string | null;
    suggested: string[] | null;
    busy: boolean;
    note: string | null;
}

const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));

/** The provenance ladder from src/products.mjs, decided at save time. */
function provenanceOf(item: Draft): Provenance {
    if (item.suggested === null) return "user-edited";
    return sameSet(item.targets, item.suggested)
        ? "user-confirmed"
        : "user-edited";
}

let seq = 0;
const blank = (): Draft => ({
    key: `tracked-${(seq += 1)}`,
    brand: "",
    name: "",
    targets: [],
    ranked: [],
    classifier: null,
    productKey: null,
    suggested: null,
    busy: false,
    note: null,
});

/** 30 days is the pre-filled default — see docs/app-ui.md §4, "Duration". */
const DURATIONS = [14, 30, 60, 90];

type DurationMode = "preset" | "claim" | "custom" | "open";

type FrequencyPreset =
    | "daily"
    | "other-day"
    | "weekly"
    | "weekdays"
    | "every-n"
    | "none";

const FREQUENCIES: { id: FrequencyPreset; label: string }[] = [
    { id: "daily", label: "Daily" },
    { id: "other-day", label: "Every other day" },
    { id: "weekly", label: "Weekly" },
    { id: "weekdays", label: "Certain days" },
    { id: "every-n", label: "Every N days" },
    { id: "none", label: "Whenever" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A pill in a single-select row. Same shape as a concern chip, on purpose. */
function Choice({
    on,
    children,
    onClick,
}: {
    on: boolean;
    children: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={on}
            onClick={onClick}
            className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
        >
            {children}
        </button>
    );
}

/** A saved routine, selectable, showing what a routine card shows. */
function RoutineChoice({
    routine,
    on,
    onClick,
}: {
    routine: RoutineOption;
    on: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={on}
            onClick={onClick}
            className={cn(
                "flex w-full flex-col gap-3 rounded-xl bg-card p-4 text-left text-sm text-card-foreground",
                "ring-1 transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                on
                    ? "ring-primary bg-accent/40"
                    : "ring-foreground/10 hover:bg-accent/30",
            )}
        >
            <div className="flex items-center justify-between gap-3">
                <h3 className="truncate text-sm font-medium">{routine.name}</h3>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {routine.products.length}{" "}
                    {routine.products.length === 1 ? "product" : "products"}
                </span>
            </div>

            {routine.products.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">
                    {routine.products.join(" · ")}
                </p>
            )}

            <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Covers</p>
                <ConcernChips
                    concerns={routine.coverage}
                    empty="No metrics tagged"
                />
            </div>
        </button>
    );
}

export function TrialEditor({
    routines,
    routinesError,
}: {
    routines: RoutineOption[];
    routinesError: string | null;
}) {
    const router = useRouter();

    const [items, setItems] = useState<Draft[]>([blank()]);
    const [name, setName] = useState("");
    const [nameTouched, setNameTouched] = useState(false);

    const [routineId, setRoutineId] = useState<string | null>(null);

    const [durationMode, setDurationMode] = useState<DurationMode>("preset");
    const [presetDays, setPresetDays] = useState(30);
    const [customDays, setCustomDays] = useState("45");
    const [claimDays, setClaimDays] = useState<number | null>(null);

    const [frequency, setFrequency] = useState<FrequencyPreset>("daily");
    const [everyN, setEveryN] = useState("3");
    const [days, setDays] = useState<number[]>([1, 3, 5]);

    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const [error, setError] = useState<string | null>(null);
    const [saving, startSaving] = useTransition();

    // The name is a suggestion until the user types one. Silently overwriting an
    // edited name on the next classifier call would be worse than not helping.
    const firstProduct = items[0]?.name.trim() ?? "";
    useEffect(() => {
        if (!nameTouched) setName(firstProduct);
    }, [firstProduct, nameTouched]);

    useEffect(() => {
        if (!photo) return;
        const url = URL.createObjectURL(photo);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [photo]);

    const patch = (key: string, change: Partial<Draft>) =>
        setItems((prev) =>
            prev.map((i) => (i.key === key ? { ...i, ...change } : i)),
        );

    async function suggest(item: Draft) {
        if (!item.name.trim()) {
            patch(item.key, { note: "Enter a product name first." });
            return;
        }
        patch(item.key, { busy: true, note: null });

        const result = await suggestConcerns({
            brand: item.brand,
            name: item.name,
        });
        if (!result.ok) {
            patch(item.key, { busy: false, note: result.error });
            return;
        }

        const data: Suggestion = result.data;
        if (data.durationClaimDays) setClaimDays(data.durationClaimDays);

        patch(item.key, {
            busy: false,
            targets: orderConcerns(data.targets),
            suggested: orderConcerns(data.targets),
            ranked: data.ranked as RankedConcern[],
            classifier: data.classifier,
            productKey: data.productKey,
            note:
                data.targets.length === 0
                    ? "Nothing came back with high confidence — tick what you want to watch."
                    : null,
        });
    }

    function frequencyValue(): Frequency {
        switch (frequency) {
            case "other-day":
                return { kind: "every-n-days", n: 2 };
            case "weekly":
                return { kind: "every-n-days", n: 7 };
            case "every-n":
                return {
                    kind: "every-n-days",
                    n: Math.max(2, Number(everyN) || 3),
                };
            case "weekdays":
                return {
                    kind: "weekdays",
                    days: [...days].sort((a, b) => a - b),
                };
            case "none":
                return { kind: "none" };
            default:
                return { kind: "daily" };
        }
    }

    function durationDays(): number | null {
        switch (durationMode) {
            case "open":
                return null;
            case "claim":
                return claimDays;
            case "custom":
                return Math.max(1, Number(customDays) || 30);
            default:
                return presetDays;
        }
    }

    /** Null is open-ended. The date is a marker, never a lock. */
    function endDate(): string | null {
        const days = durationDays();
        if (days === null) return null;
        const end = new Date();
        end.setDate(end.getDate() + days - 1);
        return new Date(end.getTime() - end.getTimezoneOffset() * 60_000)
            .toISOString()
            .slice(0, 10);
    }

    function save() {
        setError(null);
        if (!photo) {
            setError("Add a photo to start from.");
            return;
        }

        startSaving(async () => {
            const result = await startTrial(
                {
                    name,
                    interventions: items
                        .filter((i) => i.name.trim())
                        .map((i) => ({
                            brand: i.brand.trim() || null,
                            name: i.name.trim(),
                            targets: i.targets,
                            ranked: i.ranked,
                            provenance: provenanceOf(i),
                            classifier: i.classifier,
                            productKey: i.productKey,
                        })),
                    routineId,
                    endDate: endDate(),
                    endDateSource:
                        durationMode === "claim"
                            ? "product-claim"
                            : "user-chosen",
                    frequency: frequencyValue(),
                    device: navigator.userAgent,
                },
                photo,
            );

            if (!result.ok) {
                setError(result.error);
                return;
            }
            router.push(`/trials/${result.data.id}`);
            router.refresh();
        });
    }

    const tracking = orderConcerns(items.flatMap((i) => i.targets));
    const chosenRoutine = routines.find((r) => r.id === routineId) ?? null;

    return (
        <div className="mt-8 space-y-8">
            {/* ---- tracked products ---- */}
            <section className="space-y-3">
                <div className="space-y-2">
                    <Label htmlFor="trial-name">New Log</Label>
                    <Input
                        id="trial-name"
                        value={name}
                        placeholder="New Log"
                        onChange={(e) => {
                            setName(e.target.value);
                            setNameTouched(true);
                        }}
                    />
                </div>
                <h2 className="text-sm font-medium">Product(s)</h2>

                {items.map((item) => (
                    <Card key={item.key} className="gap-3 p-4">
                        <div className="flex items-start gap-2">
                            <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1.4fr]">
                                <Input
                                    value={item.brand}
                                    placeholder="Brand (optional)"
                                    aria-label="Brand"
                                    onChange={(e) =>
                                        patch(item.key, {
                                            brand: e.target.value,
                                        })
                                    }
                                />
                                <Input
                                    value={item.name}
                                    placeholder="Product, e.g. azelaic acid 10%"
                                    aria-label="Product name"
                                    onChange={(e) =>
                                        patch(item.key, {
                                            name: e.target.value,
                                        })
                                    }
                                />
                            </div>

                            {items.length > 1 && (
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Remove product"
                                    className="shrink-0"
                                    onClick={() =>
                                        setItems((prev) =>
                                            prev.filter(
                                                (i) => i.key !== item.key,
                                            ),
                                        )
                                    }
                                >
                                    <X aria-hidden />
                                </Button>
                            )}
                        </div>

                        <ConcernPicker
                            targets={item.targets}
                            ranked={item.ranked}
                            busy={item.busy}
                            note={item.note}
                            label="What you want to watch"
                            onChange={(targets) => patch(item.key, { targets })}
                            onSuggest={() => suggest(item)}
                        />
                    </Card>
                ))}

                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setItems((prev) => [...prev, blank()])}
                >
                    <Plus aria-hidden />
                    Add own
                </Button>
            </section>

            <Separator />

            {/* ---- baseline routine ---- */}
            <section className="space-y-3">
                <h2 className="text-sm font-medium">Current Routine</h2>

                {routinesError ? (
                    <p className="text-xs text-muted-foreground">
                        Saved routines are unavailable — {routinesError}
                    </p>
                ) : routines.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        No saved routines yet.
                    </p>
                ) : (
                    routines.map((r) => (
                        <RoutineChoice
                            key={r.id}
                            routine={r}
                            on={routineId === r.id}
                            onClick={() =>
                                setRoutineId(routineId === r.id ? null : r.id)
                            }
                        />
                    ))
                )}
            </section>

            <Separator />

            {/* ---- duration ---- */}
            <section className="space-y-3">
                <h2 className="text-sm font-medium">How long</h2>

                <div className="flex flex-wrap gap-1.5">
                    {DURATIONS.map((d) => (
                        <Choice
                            key={d}
                            on={durationMode === "preset" && presetDays === d}
                            onClick={() => {
                                setDurationMode("preset");
                                setPresetDays(d);
                            }}
                        >
                            {d} days
                        </Choice>
                    ))}

                    {claimDays !== null && !DURATIONS.includes(claimDays) && (
                        <Choice
                            on={durationMode === "claim"}
                            onClick={() => setDurationMode("claim")}
                        >
                            {claimDays} days — the label&rsquo;s claim
                        </Choice>
                    )}

                    <Choice
                        on={durationMode === "custom"}
                        onClick={() => setDurationMode("custom")}
                    >
                        Custom
                    </Choice>

                    <Choice
                        on={durationMode === "open"}
                        onClick={() => setDurationMode("open")}
                    >
                        Open-ended
                    </Choice>
                </div>

                {durationMode === "custom" && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Input
                            type="number"
                            min={1}
                            inputMode="numeric"
                            value={customDays}
                            aria-label="Duration in days"
                            className="max-w-24"
                            onChange={(e) => setCustomDays(e.target.value)}
                        />
                        days
                    </div>
                )}
            </section>

            <Separator />

            {/* ---- frequency ---- */}
            <section className="space-y-3">
                <h2 className="text-sm font-medium">How often</h2>
                <p className="text-xs text-muted-foreground">
                    This is how often you're applying the product.
                </p>

                <div className="flex flex-wrap gap-1.5">
                    {FREQUENCIES.map((f) => (
                        <Choice
                            key={f.id}
                            on={frequency === f.id}
                            onClick={() => setFrequency(f.id)}
                        >
                            {f.label}
                        </Choice>
                    ))}
                </div>

                {frequency === "every-n" && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        Every
                        <Input
                            type="number"
                            min={2}
                            inputMode="numeric"
                            value={everyN}
                            aria-label="Days between logs"
                            className="max-w-20"
                            onChange={(e) => setEveryN(e.target.value)}
                        />
                        days
                    </div>
                )}

                {frequency === "weekdays" && (
                    <MultiSelect
                        value={days.map(String)}
                        options={WEEKDAYS.map((label, index) => ({
                            value: String(index),
                            label,
                        }))}
                        placeholder="Choose days"
                        summary={(v) =>
                            v
                                .map(Number)
                                .sort((a, b) => a - b)
                                .map((d) => WEEKDAYS[d])
                                .join(", ")
                        }
                        onChange={(next) => setDays(next.map(Number))}
                    />
                )}
            </section>

            <Separator />

            {/* ---- baseline photo ---- */}
            <section className="space-y-3">
                <h2 className="text-sm font-medium">First Photo</h2>

                <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="sr-only"
                    onChange={(e) => {
                        setPhoto(e.target.files?.[0] ?? null);
                        setError(null);
                    }}
                />

                <Card className="items-center gap-3 p-5">
                    {preview ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a local
                        // object URL, not a remote asset the Image loader could optimise.
                        <img
                            src={preview}
                            alt="Your baseline capture"
                            className="max-h-72 w-auto rounded-md object-contain"
                        />
                    ) : (
                        <div className="flex flex-col items-center gap-1 py-6 text-center">
                            <ImageUp
                                className="size-6 text-muted-foreground"
                                aria-hidden
                            />
                            <p className="text-sm text-muted-foreground">
                                No photo yet
                            </p>
                        </div>
                    )}

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInput.current?.click()}
                    >
                        {photo ? "Choose a different photo" : "Add your photo"}
                    </Button>
                </Card>
            </section>

            <Separator />

            {/* ---- commit ---- */}
            <section className="space-y-4">
                {error && (
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                )}

                <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="animate-spin" aria-hidden />}
                    {saving ? "Analysing your photo…" : "Save & Start trial"}
                </Button>
            </section>
        </div>
    );
}
