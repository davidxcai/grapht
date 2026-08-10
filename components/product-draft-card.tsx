"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConcernPicker } from "@/components/concern-picker";
import { Thumbnail } from "@/components/thumbnail";
import { cn } from "@/lib/utils";
import type { CatalogPickerMatch } from "@/lib/catalog";
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

/**
 * The editable product row — shared verbatim by `RoutineEditor` and
 * `TrialEditorStepper` (via the `search`/`dragHandle` props below) rather
 * than each owning its own picker. The two callers must stay behaviourally
 * identical: same inline catalog search, same reserved image slot, same
 * `Sortable`/`SortableItemHandle` drag-to-reorder, same manual-only
 * "Suggest" (never auto-fired on a catalog pick — that's a paid Gemini
 * call). For the read-only equivalent see `ProductCard`; for the shared
 * image box see `Thumbnail`. Prefer extending this over building a second
 * product-editing row.
 */
export function ProductDraftCard({
    item,
    onChange,
    onRemove,
    onSuggest,
    concernLabel,
    dosage = false,
    dragHandle,
    search,
}: {
    item: ProductDraft;
    onChange: (change: Partial<ProductDraft>) => void;
    /** Omit to hide the remove button — the trial editor does this for the
     *  last remaining card so the list can never go empty. */
    onRemove?: () => void;
    onSuggest?: () => void;
    concernLabel: string;
    /** Shows the "Amount per use" field — trial-only. `true` is a plain
     *  always-visible input (routine style, currently unused); "collapsible"
     *  starts hidden behind an "Add amount" toggle (trial style), since most
     *  tracked products don't need one specified. */
    dosage?: boolean | "collapsible";
    /** Renders next to the identity field — both the routine editor and the
     *  trial stepper wrap their cards in their own <Sortable>/<SortableItem>
     *  and pass a <SortableItemHandle> here, since the product-adding flow
     *  is deliberately identical between them. */
    dragHandle?: React.ReactNode;
    /** Enables inline catalog search on the identity field itself: the
     *  two-field brand/name input collapses into one searchable field, a
     *  match fills brand from the catalog, and the image slot is always
     *  reserved so a pick never reflows the cards above it. Both the routine
     *  editor and the trial stepper pass this now — the product-adding flow
     *  is deliberately identical between them. */
    search?: {
        search: (query: string) => Promise<CatalogPickerMatch[]>;
        onPick: (match: CatalogPickerMatch) => void;
    };
}) {
    const [amountOpen, setAmountOpen] = useState(() => Boolean(item.dosage.trim()));
    const [searchOpen, setSearchOpen] = useState(false);
    const [matches, setMatches] = useState<CatalogPickerMatch[]>([]);
    const requestId = useRef(0);
    const query = item.name.trim();

    useEffect(() => {
        if (!search || !query || item.catalogProductId) {
            setMatches([]);
            return;
        }
        const id = ++requestId.current;
        const timer = setTimeout(async () => {
            const results = await search.search(query);
            if (requestId.current === id) setMatches(results);
        }, 250);
        return () => clearTimeout(timer);
    }, [search, query, item.catalogProductId]);

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

    // Inline search mode collapses brand+name into one field, since a catalog
    // pick is the only way `brand` is ever set here — typing can only edit
    // `name`.
    const editInlineName = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchOpen(true);
        onChange({
            name: e.target.value,
            brand: "",
            inci: null,
            catalogProductId: null,
            image: null,
        });
    };

    // A catalog pick shows "Product — Brand" so the match isn't lost.
    const displayValue =
        search && item.catalogProductId && item.brand
            ? `${item.name} — ${item.brand}`
            : item.name;

    const removeButton = onRemove && (
        <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove product"
            onClick={onRemove}
        >
            <X aria-hidden />
        </Button>
    );

    const dosageBlock =
        dosage === "collapsible" ? (
            // Free text on purpose: "2 pumps", "pea-sized", "20 mg" are all
            // legitimate and no unit picker fits them all. Collapsed by
            // default since most products don't need one specified.
            amountOpen ? (
                <div className="flex items-center gap-1.5">
                    <Input
                        value={item.dosage}
                        placeholder="e.g. 2 pumps"
                        aria-label="Amount per use"
                        autoFocus={!item.dosage}
                        className="flex-1"
                        onChange={(e) => onChange({ dosage: e.target.value })}
                    />
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove amount"
                        onClick={() => {
                            onChange({ dosage: "" });
                            setAmountOpen(false);
                        }}
                    >
                        <X aria-hidden />
                    </Button>
                </div>
            ) : (
                <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setAmountOpen(true)}
                >
                    <Plus className="size-3" aria-hidden />
                    Add amount
                </button>
            )
        ) : (
            dosage && (
                // Free text on purpose: "2 pumps", "pea-sized", "20 mg" are
                // all legitimate and no unit picker fits them all.
                <Input
                    value={item.dosage}
                    placeholder="Amount per use (optional), e.g. 2 pumps"
                    aria-label="Amount per use"
                    onChange={(e) => onChange({ dosage: e.target.value })}
                />
            )
        );

    const concernPicker = (
        <ConcernPicker
            targets={item.targets}
            note={item.note}
            label={concernLabel}
            onChange={(targets) => onChange({ targets })}
        />
    );

    return (
        <Card className="gap-3 p-4">
            <div className="flex items-center gap-2">
                {dragHandle}

                <div
                    className={cn(
                        "flex min-w-0 flex-1",
                        search
                            ? "flex-col gap-3 sm:flex-row"
                            : item.image
                              ? "gap-4 max-sm:flex-col"
                              : "flex-col gap-4",
                    )}
                >
                    {search ? (
                        <Thumbnail
                            src={item.image}
                            size={160}
                            className="w-full max-w-40 self-start rounded-lg ring-1 ring-foreground/10 sm:w-40"
                        />
                    ) : (
                        item.image && (
                            <Thumbnail
                                src={item.image}
                                size={160}
                                className="w-full max-w-40 self-start rounded-lg sm:w-40"
                            />
                        )
                    )}

                    {search ? (
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                            <div className="min-w-0 flex-1 space-y-3">
                                <div className="relative">
                                    <Input
                                        value={displayValue}
                                        placeholder="Search Products"
                                        aria-label="Search products"
                                        onChange={editInlineName}
                                        onFocus={() => setSearchOpen(true)}
                                        onBlur={() =>
                                            setTimeout(() => setSearchOpen(false), 150)
                                        }
                                    />

                                    {searchOpen && matches.length > 0 && (
                                        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md ring-1 ring-foreground/10">
                                            {matches.map((m) => (
                                                <li key={m.id}>
                                                    <button
                                                        type="button"
                                                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-slate-100/50"
                                                        onMouseDown={(e) =>
                                                            e.preventDefault()
                                                        }
                                                        onClick={() => {
                                                            search.onPick(m);
                                                            setSearchOpen(false);
                                                            setMatches([]);
                                                        }}
                                                    >
                                                        <Thumbnail src={m.image} size={32} className="size-8 rounded" />
                                                        <span className="min-w-0 truncate">
                                                            {m.brand
                                                                ? `${m.name} — ${m.brand}`
                                                                : m.name}
                                                        </span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                {dosageBlock}
                                {concernPicker}
                            </div>

                            {removeButton}
                        </div>
                    ) : (
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

                                {removeButton}
                            </div>

                            {dosageBlock}
                            {concernPicker}
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
}
