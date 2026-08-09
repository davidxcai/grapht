"use client";

/** `nextjs-toploader/app`, not `next/navigation` — the loader hooks anchor
 *  clicks on its own, but a programmatic push needs its wrapped router to
 *  start the bar. */
import { useRouter } from "nextjs-toploader/app";
import { useState, useTransition } from "react";
import { Loader2, Lock, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Choice } from "@/components/choice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
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
import { SearchCombobox } from "@/components/search-combobox";
import {
    ProductDraftCard,
    blankProductDraft,
    isBlankDraft,
    provenanceOfDraft,
    type ProductDraft,
} from "@/components/product-draft-card";
import { orderConcerns } from "@/lib/concerns";
import {
    removeRoutine,
    saveRoutine,
    searchCatalogForPicker,
    suggestConcerns,
    type Suggestion,
} from "@/app/routines/actions";
import type { CatalogPickerMatch } from "@/lib/catalog";
import type { RankedConcern, Routine, RoutineVisibility } from "@/lib/routines";

const VISIBILITIES: { id: RoutineVisibility; label: string; icon: typeof Lock }[] = [
    { id: "private", label: "Private", icon: Lock },
    { id: "public", label: "Public", icon: Users },
];

function fromRoutine(routine: Routine): ProductDraft[] {
    return routine.items.map((i) => ({
        key: i.id,
        brand: i.brand ?? "",
        name: i.name,
        dosage: "",
        targets: i.targets,
        ranked: i.ranked,
        classifier: i.classifier,
        productKey: i.productKey,
        catalogProductId: i.catalogProductId,
        // A saved item's targets are already a human's decision; re-deriving the
        // ladder from a stale `ranked` list would demote an edit back to a confirm.
        suggested: null,
        busy: false,
        note: null,
        inci: null,
        image: i.image,
    }));
}

export function RoutineEditor({ routine }: { routine?: Routine }) {
    const router = useRouter();
    const [name, setName] = useState(routine?.name ?? "");
    const [description, setDescription] = useState(routine?.description ?? "");
    const [visibility, setVisibility] = useState<RoutineVisibility>(
        routine?.visibility ?? "private",
    );
    const [items, setItems] = useState<ProductDraft[]>(
        routine ? fromRoutine(routine) : [blankProductDraft("draft")],
    );
    const [error, setError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, startSaving] = useTransition();
    const [deleting, startDeleting] = useTransition();

    const patch = (key: string, change: Partial<ProductDraft>) =>
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

    async function suggest(item: ProductDraft) {
        if (!item.name.trim()) {
            patch(item.key, { note: "Enter a product name first." });
            return;
        }
        patch(item.key, { busy: true, note: null });

        const result = await suggestConcerns({
            brand: item.brand,
            name: item.name,
            inci: item.inci,
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

    /** A pick from the catalog search bar above the list: add a new card
     *  (or fill the still-untouched first one) and immediately ask the
     *  classifier what it targets, using the catalog's real INCI list. */
    async function addFromCatalog(match: CatalogPickerMatch) {
        const draft: ProductDraft = {
            ...blankProductDraft("draft"),
            brand: match.brand ?? "",
            name: match.name,
            inci: match.inci,
            image: match.image,
            catalogProductId: match.id,
        };
        setItems((prev) =>
            prev.length === 1 && isBlankDraft(prev[0])
                ? [draft]
                : [...prev, draft],
        );
        await suggest(draft);
    }

    function save() {
        setError(null);
        startSaving(async () => {
            const result = await saveRoutine({
                id: routine?.id,
                name,
                description: description.trim() || null,
                visibility,
                items: items
                    .filter((i) => i.name.trim())
                    .map((i) => ({
                        brand: i.brand.trim() || null,
                        name: i.name.trim(),
                        targets: i.targets,
                        ranked: i.ranked,
                        provenance: provenanceOfDraft(i),
                        classifier: i.classifier,
                        productKey: i.productKey,
                        catalogProductId: i.catalogProductId,
                    })),
            });

            if (!result.ok) {
                setError(result.error);
                return;
            }
            toast.success(routine ? "Routine updated" : "Routine created");
            router.push("/dashboard?tab=routines");
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
            toast.success("Routine deleted");
            router.push("/dashboard?tab=routines");
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

            <div className="space-y-2">
                <Label htmlFor="routine-description">
                    Description{" "}
                    <span className="text-muted-foreground font-normal">
                        (optional)
                    </span>
                </Label>
                <Textarea
                    id="routine-description"
                    value={description}
                    placeholder="What this routine is for, or anything worth remembering about it"
                    onChange={(e) => setDescription(e.target.value)}
                />
            </div>

            <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                    <h2 className="text-sm font-medium">Products</h2>
                    <p className="text-xs text-muted-foreground">
                        In the order you use them
                    </p>
                </div>

                <SearchCombobox<CatalogPickerMatch>
                    search={searchCatalogForPicker}
                    itemKey={(m) => m.id}
                    itemLabel={(m) =>
                        m.brand ? `${m.name} — ${m.brand}` : m.name
                    }
                    itemImage={(m) => m.image}
                    onSelect={addFromCatalog}
                    placeholder="Search products to add…"
                />

                {items.map((item, index) => (
                    <ProductDraftCard
                        key={item.key}
                        item={item}
                        onChange={(change) => patch(item.key, change)}
                        onRemove={() =>
                            setItems((prev) =>
                                prev.filter((i) => i.key !== item.key),
                            )
                        }
                        onSuggest={() => suggest(item)}
                        concernLabel="What it targets"
                        reorder={{
                            canMoveUp: index > 0,
                            canMoveDown: index < items.length - 1,
                            onMove: (by) => move(index, by),
                        }}
                    />
                ))}

                <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                        setItems((prev) => [...prev, blankProductDraft("draft")])
                    }
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

            <Separator />

            <div className="space-y-3">
                <h2 className="text-sm font-medium">Who can see this?</h2>

                <div className="flex gap-1.5">
                    {VISIBILITIES.map((v) => (
                        <Choice
                            key={v.id}
                            on={visibility === v.id}
                            onClick={() => setVisibility(v.id)}
                            className="flex flex-1 items-center justify-center gap-1.5 py-2"
                        >
                            <v.icon className="size-3.5" />
                            {v.label}
                        </Choice>
                    ))}
                </div>

                <p className="text-xs text-muted-foreground">
                    {visibility === "public"
                        ? "Anyone with the link can view this routine. You can make it private again at any time."
                        : "Only you can see this routine. You can share it with anyone at any time."}
                </p>
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
