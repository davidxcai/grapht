import { redirect } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardGrid, EmptyCard } from "@/components/card-grid";
import { TrialCard } from "@/components/trial-card";
import { RoutineCard } from "@/components/routine-card";
import { toCardData } from "@/lib/trials";
import { loadTrials } from "@/lib/trial-store";
import { listSavedTrials } from "@/lib/community";
import { listRoutines, type Routine } from "@/lib/routines";
import { clerkConfigured, currentUserId } from "@/lib/auth";
import { getProfile } from "@/lib/profile-store";
import { Greeting } from "@/components/greeting";
import { timeGreeting } from "@/lib/greeting";
import { MyProductsSection } from "@/components/my-products-section";
import { loadMyProducts } from "@/app/products/actions";

/**
 * The signed-in home — the marketing page took over `/`, so the daily surface
 * lives here now.
 *
 * Two reasons this stays dynamic, either sufficient. The routine list is a live
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

/**
 * Both database reads degrade the same way. Saved routines and saved trials
 * need Neon; `loadTrials()` also unions in `fixtures/trials.json` off disk, but
 * that fixture is empty as of 2026-08-08 (CLAUDE.md, "Repository state") — the
 * two hardcoded reference trials it used to carry were deleted. A missing or
 * unreachable `DATABASE_URL` still fails soft rather than throwing, it just now
 * means an empty dashboard rather than a demo one.
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

const TABS = ["active", "completed", "routines", "saved"] as const;
type Tab = (typeof TABS)[number];

function parseTab(value: string | undefined): Tab {
    return TABS.includes(value as Tab) ? (value as Tab) : "active";
}

export default async function Dashboard({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const userId = await currentUserId();

    // The marketing page is what a signed-out visitor gets; the dashboard needs
    // someone to be the dashboard *of*. A keyless build has one implicit local
    // owner and stays here, on the demo path.
    if (!userId) redirect("/login");

    // One read, two jobs: the row's absence is how the app knows sign-up never
    // finished, and its username is the greeting. Both the email and the Google
    // paths land here first, so this is the one place that has to notice.
    //
    // `undefined` is a failed read and `null` a missing row, and the two must
    // not be conflated: bouncing a signed-in user to /welcome because Neon is
    // unreachable would trap them in a form that cannot save.
    const profile = await getProfile(userId).catch(() => undefined);
    if (clerkConfigured && profile === null) {
        redirect("/welcome");
    }

    const { trials: allTrials } = await loadTrials(userId);
    const trials = allTrials.map((t) => toCardData(t));
    const active = trials.filter((t) => t.trial.status === "active");
    const completed = trials.filter((t) => t.trial.status === "completed");
    const { routines, error } = await loadRoutines(userId);
    const { products: myProducts, error: myProductsError } = await loadMyProducts();
    const saved = await listSavedTrials(userId).catch(() => []);
    const tab = parseTab((await searchParams).tab);

    return (
        <main className="w-full px-5 py-10 lg:px-10">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">
                    <Greeting
                        initial={timeGreeting(new Date().getHours())}
                        name={profile?.username}
                    />
                </h1>
            </header>

            <Tabs defaultValue={tab} className="mt-8">
                <TabsList className="w-full grid grid-cols-3">
                    <TabsTrigger value="active">Active</TabsTrigger>
                    <TabsTrigger value="completed">Completed</TabsTrigger>
                    <TabsTrigger value="routines">Routines</TabsTrigger>
                    {/* <TabsTrigger value="saved">Saved</TabsTrigger> */}
                </TabsList>

                <TabsContent value="active" className="mt-5 space-y-3">
                    <CardGrid>
                        {active.map((d) => (
                            <TrialCard key={d.trial.id} data={d} />
                        ))}
                        <EmptyCard href="/trials/new" label="New trial" />
                    </CardGrid>
                </TabsContent>

                <TabsContent value="completed" className="mt-5 space-y-3">
                    {completed.length === 0 ? (
                        <EmptyState>
                            Nothing completed yet — finish a trial and it lands
                            here.
                        </EmptyState>
                    ) : (
                        <CardGrid>
                            {completed.map((d) => (
                                <TrialCard key={d.trial.id} data={d} />
                            ))}
                        </CardGrid>
                    )}
                </TabsContent>

                <TabsContent value="routines" className="mt-5 space-y-3">
                    {error ? (
                        <EmptyState>
                            Routines are unavailable — {error}
                        </EmptyState>
                    ) : (
                        <CardGrid>
                            {routines.map((r) => (
                                <RoutineCard key={r.id} routine={r} />
                            ))}
                            <EmptyCard
                                href="/routines/new"
                                label="New routine"
                            />
                        </CardGrid>
                    )}
                    <MyProductsSection initialProducts={myProducts} error={myProductsError} />
                </TabsContent>

                <TabsContent value="saved" className="mt-5 space-y-3">
                    {saved.length === 0 ? (
                        <EmptyState>
                            Nothing saved yet — bookmark a community trial and
                            it lands here.
                        </EmptyState>
                    ) : (
                        <CardGrid>
                            {saved.map((entry) => (
                                <TrialCard
                                    key={entry.trial.id}
                                    data={toCardData(entry.trial)}
                                    handle={entry.handle}
                                />
                            ))}
                        </CardGrid>
                    )}
                </TabsContent>
            </Tabs>
        </main>
    );
}
