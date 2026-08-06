import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { TrialEditor, type RoutineOption } from "@/components/trial-editor";
import { listRoutines, routineCoverage } from "@/lib/routines";

/** The routine list is a live database read, and the start date is "today". */
export const dynamic = "force-dynamic";

/**
 * Saved routines are a convenience here, not a dependency. Without a database
 * the picker degrades to the typed-in baseline and the trial still starts —
 * nothing on the trial path may require Neon (CLAUDE.md).
 */
async function loadOptions(): Promise<{
    routines: RoutineOption[];
    error: string | null;
}> {
    try {
        const routines = await listRoutines();
        return {
            routines: routines.map((r) => ({
                id: r.id,
                name: r.name,
                coverage: routineCoverage(r),
                products: r.items.map((i) => i.name),
            })),
            error: null,
        };
    } catch (error) {
        return { routines: [], error: (error as Error).message };
    }
}

export default async function NewTrial() {
    const { routines, error } = await loadOptions();

    return (
        <main className="mx-auto w-full max-w-2xl px-5 py-10">
            <Link
                href="/"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
                <ChevronLeft className="size-4" aria-hidden />
                Back
            </Link>

            <h1 className="mt-6 text-2xl font-semibold tracking-tight">
                New trial
            </h1>

            <TrialEditor routines={routines} routinesError={error} />
        </main>
    );
}
