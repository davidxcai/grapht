import Link from "next/link";
import { Plus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrialCard } from "@/components/trial-card";
import { RoutineCard } from "@/components/routine-card";
import { toCardData } from "@/lib/trials";
import { loadTrials } from "@/lib/trial-store";
import { listRoutines, type Routine } from "@/lib/routines";

/**
 * Two reasons, either of which is sufficient. The routine list is a live
 * database read. And `toCardData()` derives the day counter from `new Date()`,
 * so a prerendered dashboard would show whatever day it was when the build ran
 * — a ring frozen at "Day 4 / 10" for the rest of the trial.
 */
export const dynamic = "force-dynamic";

function EmptyState({ children }: { children: React.ReactNode }) {
    return (
        <p className="rounded-lg border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
            {children}
        </p>
    );
}

function NewTrialButton() {
    return (
        <Link
            href="/trials/new"
            className={buttonVariants({ size: "lg", className: "w-full" })}
        >
            <Plus className="size-4" aria-hidden />
            New trial
        </Link>
    );
}

/**
 * Both database reads degrade the same way. Saved routines and saved trials
 * need Neon; the reference series is read off disk by `loadTrials()` and always
 * renders. A missing or unreachable `DATABASE_URL` therefore costs what the
 * user created and never the demo path, which must run with no network at all
 * (BRIEF.md) — a requirement, not a nicety.
 */
async function loadRoutines(): Promise<{
    routines: Routine[];
    error: string | null;
}> {
    try {
        return { routines: await listRoutines(), error: null };
    } catch (error) {
        return { routines: [], error: (error as Error).message };
    }
}

export default async function Dashboard() {
    const { trials: allTrials } = await loadTrials();
    const trials = allTrials.map((t) => toCardData(t));
    const active = trials.filter((t) => t.trial.status === "active");
    const completed = trials.filter((t) => t.trial.status === "completed");
    const { routines, error } = await loadRoutines();

    return (
        <main className="mx-auto w-full max-w-2xl px-5 py-10">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">
                    Dashboard
                </h1>
            </header>

            <Tabs defaultValue="active" className="mt-8">
                <TabsList>
                    <TabsTrigger value="active">Active</TabsTrigger>
                    <TabsTrigger value="completed">Completed</TabsTrigger>
                    <TabsTrigger value="routines">Routines</TabsTrigger>
                </TabsList>

                <TabsContent value="active" className="mt-5 space-y-3">
                    {active.length === 0 ? (
                        <EmptyState>No trials in progress.</EmptyState>
                    ) : (
                        active.map((d) => (
                            <TrialCard key={d.trial.id} data={d} />
                        ))
                    )}
                    <NewTrialButton />
                </TabsContent>

                <TabsContent value="completed" className="mt-5 space-y-3">
                    {completed.length === 0 ? (
                        <EmptyState>No trials completed yet.</EmptyState>
                    ) : (
                        completed.map((d) => (
                            <TrialCard key={d.trial.id} data={d} />
                        ))
                    )}
                    <NewTrialButton />
                </TabsContent>

                <TabsContent value="routines" className="mt-5 space-y-3">
                    {error ? (
                        <EmptyState>
                            Routines are unavailable — {error}
                        </EmptyState>
                    ) : routines.length === 0 ? (
                        <EmptyState>
                            No routines saved. Group what you already use, then
                            pick it when you start a trial.
                        </EmptyState>
                    ) : (
                        routines.map((r) => (
                            <RoutineCard key={r.id} routine={r} />
                        ))
                    )}

                    {!error && (
                        <Link
                            href="/routines/new"
                            className={buttonVariants({
                                size: "lg",
                                className: "w-full",
                            })}
                        >
                            <Plus className="size-4" aria-hidden />
                            New routine
                        </Link>
                    )}
                </TabsContent>
            </Tabs>
        </main>
    );
}
