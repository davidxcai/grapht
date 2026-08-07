import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrialCard } from "@/components/trial-card";
import { RoutineCard } from "@/components/routine-card";
import { toCardData } from "@/lib/trials";
import { loadTrials } from "@/lib/trial-store";
import { listRoutines, type Routine } from "@/lib/routines";
import { clerkConfigured, currentUserId } from "@/lib/auth";
import { needsOnboarding } from "@/lib/profile-store";

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
 * What a signed-out visitor gets where the create buttons would be. The sample
 * trial above it is fully readable without an account — it is the published
 * reference series — but a trial of your own needs somewhere to keep it.
 */
function LoginPrompt({ children }: { children: React.ReactNode }) {
    return (
        <Link
            href="/login"
            className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "w-full",
            })}
        >
            {children}
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
async function loadRoutines(userId: string): Promise<{
    routines: Routine[];
    error: string | null;
}> {
    try {
        return { routines: await listRoutines(userId), error: null };
    } catch (error) {
        return { routines: [], error: (error as Error).message };
    }
}

export default async function Dashboard() {
    const userId = await currentUserId();

    // An account that never finished sign-up has no username, skin type or
    // birthday. Both the email and the Google paths land here first, so this is
    // the one place that has to notice. A keyless build has no accounts to
    // finish and no Clerk to render the screen — it stays on the demo path.
    if (clerkConfigured && userId && (await needsOnboarding(userId))) {
        redirect("/welcome");
    }

    const { trials: allTrials } = await loadTrials(userId);
    const trials = allTrials.map((t) => toCardData(t));
    const active = trials.filter((t) => t.trial.status === "active");
    const completed = trials.filter((t) => t.trial.status === "completed");
    const { routines, error } = userId
        ? await loadRoutines(userId)
        : { routines: [], error: null };

    return (
        <main className="mx-auto w-full max-w-4xl px-5 py-10">
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
                    {userId ? (
                        <NewTrialButton />
                    ) : (
                        <LoginPrompt>Log in to start your own trial</LoginPrompt>
                    )}
                </TabsContent>

                <TabsContent value="completed" className="mt-5 space-y-3">
                    {completed.length === 0 ? (
                        <EmptyState>No trials completed yet.</EmptyState>
                    ) : (
                        completed.map((d) => (
                            <TrialCard key={d.trial.id} data={d} />
                        ))
                    )}
                    {userId ? (
                        <NewTrialButton />
                    ) : (
                        <LoginPrompt>Log in to start your own trial</LoginPrompt>
                    )}
                </TabsContent>

                <TabsContent value="routines" className="mt-5 space-y-3">
                    {!userId ? (
                        <>
                            <EmptyState>
                                Group the products you already use, then pick
                                the set when you start a trial.
                            </EmptyState>
                            <LoginPrompt>
                                Log in to save a routine
                            </LoginPrompt>
                        </>
                    ) : error ? (
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

                    {userId && !error && (
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
