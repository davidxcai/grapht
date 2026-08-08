import { RoutineEditor } from "@/components/routine-editor";
import { requireOnboardedUserId } from "@/lib/profile-store";

export default async function NewRoutine() {
    await requireOnboardedUserId();

    return (
        <main className="w-full px-5 py-10 lg:px-10">
            <h1 className="text-2xl font-semibold tracking-tight">
                New Routine
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
                Save your routines here.
            </p>

            <RoutineEditor />
        </main>
    );
}
