import { TrialEditor, type RoutineOption } from "@/components/trial-editor";
import { listRoutines, routineCoverage } from "@/lib/routines";
import { requireOnboardedUserId } from "@/lib/profile-store";

/** The routine list is a live database read, and the start date is "today". */
export const dynamic = "force-dynamic";

/**
 * Saved routines are a convenience here, not a dependency. Without a database
 * the picker degrades to the typed-in baseline and the trial still starts —
 * nothing on the trial path may require Neon (CLAUDE.md).
 */
async function loadOptions(userId: string): Promise<{
    routines: RoutineOption[];
    error: string | null;
}> {
    try {
        const routines = await listRoutines(userId);
        return {
            routines: routines.map((r) => ({
                id: r.id,
                name: r.name,
                coverage: routineCoverage(r),
                items: r.items.map((i) => ({ id: i.id, name: i.name, image: i.image })),
            })),
            error: null,
        };
    } catch (error) {
        return { routines: [], error: (error as Error).message };
    }
}

export default async function NewTrial() {
    const userId = await requireOnboardedUserId();
    const { routines, error } = await loadOptions(userId);

    return (
        <main className="w-full px-5 py-10 lg:px-10">
            <TrialEditor routines={routines} routinesError={error} />
        </main>
    );
}
