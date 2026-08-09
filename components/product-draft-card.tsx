"use client";

import Image from "next/image";
import { ArrowDown, ArrowUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConcernPicker } from "@/components/concern-picker";
import { cn } from "@/lib/utils";
import type { Provenance, RankedConcern } from "@/lib/routines";

/**
 * A product row being edited — the shape shared by the routine editor (a
 * saved, ordered routine) and the trial editor (products tracked for a
 * trial). Not every field is meaningful in both places: `dosage` is
 * trial-only. `catalogProductId` is persisted in both — `trial_interventions`
 * mirrors `routine_items.catalog_product_id` (see that migration's comment) —
 * as read-only enrichment for a thumbnail; `targets[]` still freeze at
 * creation and never re-derive from it. Carrying the full shape in both lets
 * them share one card and one add-from-catalog flow instead of two
 * near-identical ones.
 */
export interface ProductDraft {
    key: string;
    brand: string;
    name: string;
    dosage: string;
    targets: string[];
    ranked: RankedConcern[];
    classifier: { model: string; promptVersion: string } | null;
    productKey: string | null;
    /** What the classifier pre-ticked, so an untouched accept can be recorded
     *  as `user-confirmed` rather than `user-edited`. Null means never
     *  classified. */
    suggested: string[] | null;
    busy: boolean;
    note: string | null;
    /** From a /catalog match — the real ingredient list, passed to
     *  classifyProduct so "Suggest" reasons from evidence instead of the
     *  typed name alone (docs/product-identity.md). Cleared on manual edit,
     *  since it no longer describes what's actually typed. */
    inci: string[] | null;
    /** FK into catalog_products, set only from a /catalog pick. */
    catalogProductId: string | null;
    /** From a /catalog match, display-only — never itself persisted; both a
     *  routine (lib/routines.ts) and a trial (lib/trial-store.ts) re-derive
     *  it live via catalogProductId instead. */
    image: string | null;
}

const sameTargetSet = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));

/** The provenance ladder from src/products.mjs, decided at save time. */
export function provenanceOfDraft(item: ProductDraft): Provenance {
    if (item.suggested === null) return "user-edited";
    return sameTargetSet(item.targets, item.suggested)
        ? "user-confirmed"
        : "user-edited";
}

/** True for an untouched blank card — safe to replace outright rather than
 *  leaving an empty card sitting above a catalog pick. */
export function isBlankDraft(item: ProductDraft) {
    return !item.brand.trim() && !item.name.trim() && item.targets.length === 0;
}

let seq = 0;
export function blankProductDraft(keyPrefix: string): ProductDraft {
    return {
        key: `${keyPrefix}-${(seq += 1)}`,
        brand: "",
        name: "",
        dosage: "",
        targets: [],
        ranked: [],
        classifier: null,
        productKey: null,
        suggested: null,
        busy: false,
        note: null,
        inci: null,
        catalogProductId: null,
        image: null,
    };
}

export function ProductDraftCard({
    item,
    onChange,
    onRemove,
    onSuggest,
    concernLabel,
    dosage = false,
    reorder,
}: {
    item: ProductDraft;
    onChange: (change: Partial<ProductDraft>) => void;
    /** Omit to hide the remove button — the trial editor does this for the
     *  last remaining card so the list can never go empty. */
    onRemove?: () => void;
    onSuggest: () => void;
    concernLabel: string;
    /** Shows the "Amount per use" field — trial-only. */
    dosage?: boolean;
    /** Shows the move up/down arrows — routine-only, since a routine's order
     *  is meaningful ("in the order you use them") and a trial's tracked
     *  list isn't. */
    reorder?: {
        canMoveUp: boolean;
        canMoveDown: boolean;
        onMove: (by: number) => void;
    };
}) {
    /** A hand-typed edit no longer describes whatever catalog product this
     *  card used to point at. */
    const editIdentity =
        (field: "brand" | "name") =>
        (e: React.ChangeEvent<HTMLInputElement>) =>
            onChange({
                [field]: e.target.value,
                inci: null,
                catalogProductId: null,
                image: null,
            });

    return (
        <Card className="gap-3 p-4">
            <div className={cn(item.image && "flex gap-4 max-sm:flex-col")}>
                {item.image && (
                    <div className="aspect-square w-full max-w-sm max-h-sm shrink-0 self-start overflow-hidden rounded-lg bg-white sm:self-stretch sm:max-h-none sm:max-w-none sm:w-auto">
                        <Image
                            src={item.image}
                            alt=""
                            width={160}
                            height={160}
                            unoptimized
                            className="size-full object-contain"
                        />
                    </div>
                )}
                <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex items-start gap-2">
                        <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1.4fr]">
                            <Input
                                value={item.brand}
                                placeholder="Brand (optional)"
                                aria-label="Brand"
                                onChange={editIdentity("brand")}
                            />
                            <Input
                                value={item.name}
                                placeholder="Product, e.g. niacinamide serum"
                                aria-label="Product name"
                                onChange={editIdentity("name")}
                            />
                        </div>

                        <div className="flex shrink-0 gap-0.5">
                            {reorder && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Move up"
                                        disabled={!reorder.canMoveUp}
                                        onClick={() => reorder.onMove(-1)}
                                    >
                                        <ArrowUp aria-hidden />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Move down"
                                        disabled={!reorder.canMoveDown}
                                        onClick={() => reorder.onMove(1)}
                                    >
                                        <ArrowDown aria-hidden />
                                    </Button>
                                </>
                            )}
                            {onRemove && (
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Remove product"
                                    onClick={onRemove}
                                >
                                    <X aria-hidden />
                                </Button>
                            )}
                        </div>
                    </div>

                    {dosage && (
                        // Free text on purpose: "2 pumps", "pea-sized", "20 mg"
                        // are all legitimate and no unit picker fits them all.
                        <Input
                            value={item.dosage}
                            placeholder="Amount per use (optional), e.g. 2 pumps"
                            aria-label="Amount per use"
                            onChange={(e) =>
                                onChange({ dosage: e.target.value })
                            }
                        />
                    )}

                    <ConcernPicker
                        targets={item.targets}
                        note={item.note}
                        label={concernLabel}
                        onChange={(targets) => onChange({ targets })}
                    />
                </div>
            </div>
        </Card>
    );
}
