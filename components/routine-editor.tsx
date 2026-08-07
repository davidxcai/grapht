"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ConcernChips } from "@/components/concern-chips";
import { ConcernPicker } from "@/components/concern-picker";
import { orderConcerns } from "@/lib/concerns";
import { cn } from "@/lib/utils";
import {
    removeRoutine,
    saveRoutine,
    suggestConcerns,
    type Suggestion,
} from "@/app/routines/actions";
import type { Provenance, RankedConcern, Routine } from "@/lib/routines";

interface Draft {
    key: string;
    brand: string;
    name: string;
    targets: string[];
    ranked: RankedConcern[];
    classifier: { model: string; promptVersion: string } | null;
    productKey: string | null;
    /** What the classifier pre-ticked, so an untouched accept can be recorded as
     *  `user-confirmed` rather than `user-edited`. Null means never classified. */
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
    key: `draft-${(seq += 1)}`,
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

function fromRoutine(routine: Routine): Draft[] {
    return routine.items.map((i) => ({
        key: i.id,
        brand: i.brand ?? "",
        name: i.name,
        targets: i.targets,
        ranked: i.ranked,
        classifier: i.classifier,
        productKey: i.productKey,
        // A saved item's targets are already a human's decision; re-deriving the
        // ladder from a stale `ranked` list would demote an edit back to a confirm.
        suggested: null,
        busy: false,
        note: null,
    }));
}

export function RoutineEditor({ routine }: { routine?: Routine }) {
    const router = useRouter();
    const [name, setName] = useState(routine?.name ?? "");
    const [items, setItems] = useState<Draft[]>(
        routine ? fromRoutine(routine) : [blank()],
    );
    const [error, setError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, startSaving] = useTransition();
    const [deleting, startDeleting] = useTransition();

    const patch = (key: string, change: Partial<Draft>) =>
        setItems((prev) =>
            prev.map((i) => (i.key === key ? { ...i, ...change } : i)),
        );

    const move = (index: number, by: number) =>
        setItems((prev) => {
            const next = [...prev];
            const to = index + by;
            if (to < 0 || to >= next.length) return prev;
            [next[index], next[to]] = [next[to], next[index]];
            return next;
        });

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
        patch(item.key, {
            busy: false,
            targets: orderConcerns(data.targets),
            suggested: orderConcerns(data.targets),
            ranked: data.ranked as RankedConcern[],
            classifier: data.classifier,
            productKey: data.productKey,
            note:
                data.targets.length === 0
                    ? "Nothing came back with high confidence — tick what you know it targets."
                    : null,
        });
    }

    function save() {
        setError(null);
        startSaving(async () => {
            const result = await saveRoutine({
                id: routine?.id,
                name,
                items: items
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
            });

            if (!result.ok) {
                setError(result.error);
                return;
            }
            router.push("/");
            router.refresh();
        });
    }

    function destroy() {
        if (!routine) return;
        startDeleting(async () => {
            const result = await removeRoutine(routine.id);
            if (!result.ok) {
                // Close first: `AlertDialogAction` is a plain button, so the overlay
                // would otherwise sit on top of the error and the failure would read as
                // nothing having happened.
                setConfirmOpen(false);
                setError(result.error);
                return;
            }
            router.push("/");
            router.refresh();
        });
    }

    const coverage = orderConcerns(items.flatMap((i) => i.targets));
    const hasProduct = items.some((i) => i.name.trim());

    return (
        <div className="mt-8 space-y-6">
            <div className="space-y-2">
                <Label htmlFor="routine-name">Routine name</Label>
                <Input
                    id="routine-name"
                    value={name}
                    placeholder="e.g Morning"
                    onChange={(e) => setName(e.target.value)}
                />
            </div>

            <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                    <h2 className="text-sm font-medium">Products</h2>
                    <p className="text-xs text-muted-foreground">
                        In the order you use them
                    </p>
                </div>

                {items.map((item, index) => (
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
                                    placeholder="Product, e.g. niacinamide serum"
                                    aria-label="Product name"
                                    onChange={(e) =>
                                        patch(item.key, {
                                            name: e.target.value,
                                        })
                                    }
                                />
                            </div>

                            <div className="flex shrink-0 gap-0.5">
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Move up"
                                    disabled={index === 0}
                                    onClick={() => move(index, -1)}
                                >
                                    <ArrowUp aria-hidden />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Move down"
                                    disabled={index === items.length - 1}
                                    onClick={() => move(index, 1)}
                                >
                                    <ArrowDown aria-hidden />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Remove product"
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
                            </div>
                        </div>

                        <ConcernPicker
                            targets={item.targets}
                            ranked={item.ranked}
                            busy={item.busy}
                            note={item.note}
                            label="What it targets"
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
                    Add product
                </Button>
            </div>

            <Separator />

            <div>
                <h2 className="text-sm font-medium">This routine covers</h2>
                <ConcernChips
                    concerns={coverage}
                    className="mt-3"
                    empty="Nothing tracked yet"
                />
            </div>

            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}

            <div className="flex items-center justify-between gap-3">
                <Button
                    onClick={save}
                    disabled={saving || !hasProduct}
                    className={"w-full"}
                >
                    {saving && <Loader2 className="animate-spin" aria-hidden />}
                    {routine ? "Save Changes" : "Create Routine"}
                </Button>

                {routine && (
                    <AlertDialog
                        open={confirmOpen}
                        onOpenChange={setConfirmOpen}
                    >
                        <AlertDialogTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground"
                                >
                                    <Trash2 aria-hidden />
                                    Delete
                                </Button>
                            }
                        />
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>
                                    Delete &ldquo;{routine.name}&rdquo;?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    Trials that already use this routine keep
                                    their own copy of it, so their results
                                    don&rsquo;t change. You just won&rsquo;t be
                                    able to pick it for a new one.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Keep</AlertDialogCancel>
                                <AlertDialogAction
                                    variant="destructive"
                                    disabled={deleting}
                                    onClick={destroy}
                                >
                                    Delete
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
            </div>
        </div>
    );
}
