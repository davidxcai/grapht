"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

export interface RoutineOption {
    id: string;
    name: string;
    coverage: string[];
    items: { id: string; name: string; image: string | null }[];
}
import {
    Camera,
    ChevronLeft,
    ChevronRight,
    GripVertical,
    Loader2,
    Lock,
    Moon,
    Pencil,
    Plus,
    Sun,
    Users,
    X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CameraCapture } from "@/components/camera-capture";
import { Choice } from "@/components/choice";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    ProductDraftCard,
    blankProductDraft,
    provenanceOfDraft,
    type ProductDraft,
} from "@/components/product-draft-card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    RadioGroup,
    RadioGroupItem,
} from "@/components/ui/radio-group";
import {
    Stepper,
    StepperContent,
    StepperIndicator,
    StepperItem,
    StepperNav,
    StepperPanel,
    StepperSeparator,
    StepperTitle,
    StepperTrigger,
} from "@/src/components/reui/stepper";
import {
    Sortable,
    SortableItem,
    SortableItemHandle,
} from "@/src/components/reui/sortable";
import { orderConcerns } from "@/lib/concerns";
import { suggestConcerns, type Suggestion } from "@/app/routines/actions";
import { startTrial, searchCatalogForPicker } from "@/app/trials/actions";
import { RoutineSummary } from "@/components/routine-summary";
import type { CatalogPickerMatch } from "@/lib/catalog";
import type { RankedConcern } from "@/lib/routines";
import type { Frequency, TimeOfDay, TrialVisibility } from "@/lib/trials";

/** 30 days is the pre-filled default — see docs/app-ui.md §4, "Duration". */
const DURATIONS = [14, 30, 60];

type DurationMode = "preset" | "claim" | "custom";
type DurationUnit = "days" | "weeks" | "months" | "years";

const DURATION_UNITS: { id: DurationUnit; label: string; days: number }[] = [
    { id: "days", label: "days", days: 1 },
    { id: "weeks", label: "weeks", days: 7 },
    { id: "months", label: "months", days: 30 },
    { id: "years", label: "years", days: 365 },
];

type FrequencyPreset = "daily" | "other-day" | "custom";

const FREQUENCIES: { id: FrequencyPreset; label: string }[] = [
    { id: "daily", label: "Daily" },
    { id: "other-day", label: "Every Other Day" },
    { id: "custom", label: "Custom" },
];

/** `id` stays "am"/"pm" — that's the wire format (TimeOfDay) — only the
 *  on-screen label changed to Day/Night. */
const TIMES_OF_DAY: { id: TimeOfDay; label: string; icon: typeof Sun }[] = [
    { id: "am", label: "Day", icon: Sun },
    { id: "pm", label: "Night", icon: Moon },
];

/** Only me is first and is the default; sharing is never the fallback. */
const VISIBILITIES: {
    id: TrialVisibility;
    label: string;
    icon: typeof Sun;
}[] = [
    { id: "private", label: "Only me", icon: Lock },
    { id: "public", label: "Everyone", icon: Users },
];

/** Click the title, or its pencil, to rename inline. Blank falls back to "New Trial". */
function TitleEditor({
    value,
    onChange,
}: {
    value: string;
    onChange: (next: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    if (editing) {
        return (
            <Input
                ref={inputRef}
                value={value}
                placeholder="New Trial"
                aria-label="Trial title"
                className="h-9 max-w-sm text-lg font-semibold"
                onChange={(e) => onChange(e.target.value)}
                onBlur={() => setEditing(false)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") {
                        e.preventDefault();
                        setEditing(false);
                    }
                }}
            />
        );
    }

    return (
        <button
            type="button"
            onClick={() => setEditing(true)}
            className="group flex items-center gap-1.5 text-lg font-semibold"
        >
            {value.trim() || "New Trial"}
            <Pencil
                className="size-3.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100"
                aria-hidden
            />
        </button>
    );
}

/** Bigger than the default Button size at mobile widths — these are the
 *  thumb targets for stepping through the whole flow, so they shrink back
 *  down to normal only once there's a pointer to aim with. */
const NAV_BUTTON_CLASS = "h-11 px-5 text-sm sm:h-9 sm:px-2.5 sm:text-[0.8125rem]";

function StepFooter({
    onBack,
    onNext,
    nextLabel = "Next",
    nextDisabled = false,
    nextBusy = false,
}: {
    onBack?: () => void;
    onNext?: () => void;
    nextLabel?: string;
    nextDisabled?: boolean;
    nextBusy?: boolean;
}) {
    return (
        <div className="flex items-center justify-between pt-4">
            {onBack ? (
                <Button variant="outline" className={NAV_BUTTON_CLASS} onClick={onBack}>
                    <ChevronLeft aria-hidden />
                    Back
                </Button>
            ) : (
                <span />
            )}
            {onNext && (
                <Button size="lg" onClick={onNext} disabled={nextDisabled || nextBusy}>
                    {nextBusy && <Loader2 className="animate-spin" aria-hidden />}
                    {nextLabel}
                    {!nextBusy && <ChevronRight aria-hidden />}
                </Button>
            )}
        </div>
    );
}

/** Steps are computed from the toggles on the first page, so the count is 5 or 6. */
type StepKey = "intro" | "product" | "routine" | "schedule" | "photo" | "review";

const STEP_LABELS: Record<StepKey, string> = {
    intro: "Track",
    product: "Product",
    routine: "Routine",
    schedule: "Schedule",
    photo: "Photo",
    review: "Review",
};


export function TrialEditorStepper({
    routines,
    routinesError,
}: {
    routines: RoutineOption[];
    routinesError: string | null;
}) {
    const router = useRouter();

    const [activeStep, setActiveStep] = useState(1);

    const [trackProduct, setTrackProduct] = useState(true);
    const [trackRoutine, setTrackRoutine] = useState(true);

    const steps = useMemo<StepKey[]>(() => {
        const s: StepKey[] = ["intro"];
        if (trackProduct) s.push("product");
        if (trackRoutine) s.push("routine");
        s.push("schedule", "photo", "review");
        return s;
    }, [trackProduct, trackRoutine]);

    function toggleProduct(on: boolean) {
        if (!on && !trackRoutine) return; // at least one must stay on
        setTrackProduct(on);
    }

    function toggleRoutine(on: boolean) {
        if (!on && !trackProduct) return; // at least one must stay on
        setTrackRoutine(on);
        if (!on) setRoutineId(null);
    }

    function goNext() {
        setActiveStep((s) => Math.min(s + 1, steps.length));
    }
    function goBack() {
        setActiveStep((s) => Math.max(s - 1, 1));
    }

    // Every field below lives here, in the flow's top-level state, rather than
    // inside a per-step component — StepperContent unmounts inactive steps
    // (src/components/reui/stepper.tsx), so state that lived there instead
    // would be lost on Back. Hoisting it here is what makes Back non-destructive.
    const [items, setItems] = useState<ProductDraft[]>([
        blankProductDraft("tracked"),
    ]);
    const [name, setName] = useState("");
    const [nameTouched, setNameTouched] = useState(false);

    const [routineId, setRoutineId] = useState<string | null>(null);
    const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("am");
    const [visibility, setVisibility] = useState<TrialVisibility>("private");

    const [durationMode, setDurationMode] = useState<DurationMode>("preset");
    const [presetDays, setPresetDays] = useState(14);
    const [customDays, setCustomDays] = useState("45");
    const [customUnit, setCustomUnit] = useState<DurationUnit>("days");
    const [claimDays, setClaimDays] = useState<number | null>(null);

    const [frequency, setFrequency] = useState<FrequencyPreset>("daily");
    const [everyN, setEveryN] = useState("3");

    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [cameraOpen, setCameraOpen] = useState(false);

    const [error, setError] = useState<string | null>(null);
    const [saving, startSaving] = useTransition();

    // The name is a suggestion until the user types one. Silently overwriting an
    // edited name on the next classifier call would be worse than not helping.
    const firstProduct = items[0]?.name.trim() ?? "";
    useEffect(() => {
        if (!nameTouched) setName(firstProduct);
    }, [firstProduct, nameTouched]);

    useEffect(() => {
        if (!photo) return;
        const url = URL.createObjectURL(photo);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [photo]);

    const patch = (key: string, change: Partial<ProductDraft>) =>
        setItems((prev) =>
            prev.map((i) => (i.key === key ? { ...i, ...change } : i)),
        );

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
        if (data.durationClaimDays) setClaimDays(data.durationClaimDays);

        patch(item.key, {
            busy: false,
            targets: orderConcerns(data.targets),
            suggested: orderConcerns(data.targets),
            ranked: data.ranked as RankedConcern[],
            classifier: data.classifier,
            productKey: data.productKey,
            note:
                data.targets.length === 0
                    ? "Nothing came back with high confidence — tick what you want to watch."
                    : null,
        });
    }

    /** A pick from the card's own inline search fills brand, name, image and
     *  the catalog's real INCI list — no AI call. Metrics still come from the
     *  "Suggest" button in ConcernPicker, which the user must trigger
     *  themselves: the classifier is a paid Gemini call and must never fire
     *  automatically just because a catalog match was picked. */
    function applyCatalogMatch(item: ProductDraft, match: CatalogPickerMatch) {
        patch(item.key, {
            brand: match.brand ?? "",
            name: match.name,
            inci: match.inci,
            image: match.image,
            catalogProductId: match.id,
        });
    }

    function frequencyValue(): Frequency {
        switch (frequency) {
            case "other-day":
                return { kind: "every-n-days", n: 2 };
            case "custom":
                return {
                    kind: "every-n-days",
                    n: Math.max(2, Number(everyN) || 3),
                };
            default:
                return { kind: "daily" };
        }
    }

    function durationDays(): number | null {
        switch (durationMode) {
            case "claim":
                return claimDays;
            case "custom": {
                const unitDays =
                    DURATION_UNITS.find((u) => u.id === customUnit)?.days ?? 1;
                return Math.max(1, Number(customDays) || 30) * unitDays;
            }
            default:
                return presetDays;
        }
    }

    /** The date is a marker, never a lock — see docs/app-ui.md §4, "Duration". */
    function endDate(): string | null {
        const days = durationDays();
        if (days === null) return null;
        const end = new Date();
        end.setDate(end.getDate() + days - 1);
        return new Date(end.getTime() - end.getTimezoneOffset() * 60_000)
            .toISOString()
            .slice(0, 10);
    }

    function save() {
        setError(null);
        if (!photo) {
            setError("Add a photo to start from.");
            return;
        }

        startSaving(async () => {
            const result = await startTrial(
                {
                    name,
                    interventions: trackProduct
                        ? items
                              .filter((i) => i.name.trim())
                              .map((i) => ({
                                  brand: i.brand.trim() || null,
                                  name: i.name.trim(),
                                  dosage: i.dosage.trim() || null,
                                  targets: i.targets,
                                  ranked: i.ranked,
                                  provenance: provenanceOfDraft(i),
                                  classifier: i.classifier,
                                  productKey: i.productKey,
                                  catalogProductId: i.catalogProductId,
                              }))
                        : [],
                    routineId: trackRoutine ? routineId : null,
                    endDate: endDate(),
                    endDateSource:
                        durationMode === "claim"
                            ? "product-claim"
                            : "user-chosen",
                    timeOfDay,
                    visibility,
                    frequency: frequencyValue(),
                    device: navigator.userAgent,
                },
                photo,
            );

            if (!result.ok) {
                setError(result.error);
                return;
            }
            toast.success("Trial started");
            router.push(`/trials/${result.data.id}`);
            router.refresh();
        });
    }

    const chosenRoutine = routines.find((r) => r.id === routineId) ?? null;

    function renderStep(key: StepKey) {
        switch (key) {
            case "intro":
                return (
                    <div className="space-y-6">
                        <h2 className="text-sm font-medium">
                            What are we tracking?
                        </h2>

                        <RadioGroup value={trackProduct && trackRoutine ? "both" : trackProduct ? "product" : "routine"}>
                            <div className="space-y-3">
                                <label
                                    className="flex items-start gap-3 rounded-xl border p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                                    onClick={() => {
                                        setTrackProduct(true);
                                        setTrackRoutine(true);
                                    }}
                                >
                                    <RadioGroupItem value="both" className="mt-1" />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium">
                                            Product & Routine
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Track a new product within your existing routine
                                        </p>
                                    </div>
                                </label>
                                <label
                                    className="flex items-start gap-3 rounded-xl border p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                                    onClick={() => {
                                        setTrackProduct(true);
                                        setTrackRoutine(false);
                                    }}
                                >
                                    <RadioGroupItem value="product" className="mt-1" />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium">
                                            Product only
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Something new you&rsquo;re adding
                                        </p>
                                    </div>
                                </label>
                                <label
                                    className="flex items-start gap-3 rounded-xl border p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                                    onClick={() => {
                                        setTrackProduct(false);
                                        setTrackRoutine(true);
                                    }}
                                >
                                    <RadioGroupItem value="routine" className="mt-1" />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium">
                                            Routine only
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Your existing routine, as context or on its own
                                        </p>
                                    </div>
                                </label>
                            </div>
                        </RadioGroup>

                        <div className="space-y-2">
                            <Label>Time of day</Label>
                            <div className="flex gap-1.5">
                                {TIMES_OF_DAY.map((t) => (
                                    <Choice
                                        key={t.id}
                                        on={timeOfDay === t.id}
                                        onClick={() => setTimeOfDay(t.id)}
                                        className="flex flex-1 items-center justify-center gap-1.5 py-2"
                                    >
                                        <t.icon className="size-3.5" />
                                        {t.label}
                                    </Choice>
                                ))}
                            </div>
                        </div>

                        <StepFooter onNext={goNext} />
                    </div>
                );

            case "product":
                return (
                    <div className="space-y-3">
                        <h2 className="text-sm font-medium">Product(s)</h2>

                        <Sortable
                            value={items}
                            onValueChange={setItems}
                            getItemValue={(i) => i.key}
                            strategy="vertical"
                            className="space-y-3"
                        >
                            {items.map((item) => (
                                <SortableItem key={item.key} value={item.key}>
                                    <ProductDraftCard
                                        item={item}
                                        concernLabel="What's this for?"
                                        dosage="collapsible"
                                        onChange={(change) => patch(item.key, change)}
                                        onRemove={
                                            items.length > 1
                                                ? () =>
                                                      setItems((prev) =>
                                                          prev.filter(
                                                              (i) => i.key !== item.key,
                                                          ),
                                                      )
                                                : undefined
                                        }
                                        search={{
                                            search: searchCatalogForPicker,
                                            onPick: (match) =>
                                                applyCatalogMatch(item, match),
                                        }}
                                        dragHandle={
                                            <SortableItemHandle
                                                render={
                                                    <button
                                                        type="button"
                                                        aria-label="Drag to reorder"
                                                        className="mt-2 shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
                                                    />
                                                }
                                            >
                                                <GripVertical
                                                    className="size-4"
                                                    aria-hidden
                                                />
                                            </SortableItemHandle>
                                        }
                                    />
                                </SortableItem>
                            ))}
                        </Sortable>

                        <Button
                            variant="outline"
                            size="lg"
                            className="h-12 w-full border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                            onClick={() =>
                                setItems((prev) => [
                                    ...prev,
                                    blankProductDraft("tracked"),
                                ])
                            }
                        >
                            <Plus aria-hidden />
                            Add product
                        </Button>

                        <StepFooter onBack={goBack} onNext={goNext} />
                    </div>
                );

            case "routine":
                return (
                    <div className="space-y-3">
                        <h2 className="text-sm font-medium">Routine</h2>

                        {routinesError ? (
                            <p className="text-xs text-muted-foreground">
                                Saved routines are unavailable —{" "}
                                {routinesError}
                            </p>
                        ) : routines.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                No saved routines yet.
                            </p>
                        ) : (
                            <>
                                <Select
                                    value={routineId}
                                    onValueChange={(next: unknown) =>
                                        setRoutineId((next as string) ?? null)
                                    }
                                >
                                    <SelectTrigger
                                        aria-label="Routine"
                                        className="h-9 w-full"
                                    >
                                        <SelectValue placeholder="Choose a routine">
                                            {(value: string | null) =>
                                                routines.find(
                                                    (r) => r.id === value,
                                                )?.name ?? "Choose a routine"
                                            }
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent
                                        align="start"
                                        alignItemWithTrigger={false}
                                    >
                                        {routines.map((r) => (
                                            <SelectItem key={r.id} value={r.id}>
                                                {r.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {chosenRoutine && (
                                    <div className="flex w-full flex-col gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
                                        <RoutineSummary
                                            routine={chosenRoutine}
                                            as="h3"
                                            titleClassName="text-sm"
                                        />
                                    </div>
                                )}
                            </>
                        )}

                        <StepFooter onBack={goBack} onNext={goNext} />
                    </div>
                );

            // UI pass still pending here — duration/frequency work correctly
            // but haven't been revisited for spacing/visual polish like the
            // other steps have.
            case "schedule":
                return (
                    <div className="space-y-6">
                        <section className="space-y-3">
                            <h2 className="text-sm font-medium">
                                How long are we tracking?
                            </h2>

                            <div className="flex gap-1.5">
                                {DURATIONS.map((d) => (
                                    <Choice
                                        key={d}
                                        on={
                                            durationMode === "preset" &&
                                            presetDays === d
                                        }
                                        onClick={() => {
                                            setDurationMode("preset");
                                            setPresetDays(d);
                                        }}
                                        className="flex-1 justify-center text-center"
                                    >
                                        {d} days
                                    </Choice>
                                ))}

                                {claimDays !== null &&
                                    !DURATIONS.includes(claimDays) && (
                                        <Choice
                                            on={durationMode === "claim"}
                                            onClick={() =>
                                                setDurationMode("claim")
                                            }
                                            className="flex-1 justify-center text-center"
                                        >
                                            {claimDays} days — the
                                            label&rsquo;s claim
                                        </Choice>
                                    )}

                                <Choice
                                    on={durationMode === "custom"}
                                    onClick={() => setDurationMode("custom")}
                                    className="flex-1 justify-center text-center"
                                >
                                    Custom
                                </Choice>
                            </div>

                            {durationMode === "custom" && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Input
                                        type="number"
                                        min={1}
                                        inputMode="numeric"
                                        value={customDays}
                                        aria-label="Duration"
                                        className="flex-1"
                                        onChange={(e) =>
                                            setCustomDays(e.target.value)
                                        }
                                    />
                                    <Select
                                        value={customUnit}
                                        onValueChange={(next: unknown) =>
                                            setCustomUnit(
                                                next as DurationUnit,
                                            )
                                        }
                                    >
                                        <SelectTrigger
                                            aria-label="Duration unit"
                                            className="h-9 flex-1"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent
                                            align="start"
                                            alignItemWithTrigger={false}
                                        >
                                            {DURATION_UNITS.map((u) => (
                                                <SelectItem
                                                    key={u.id}
                                                    value={u.id}
                                                >
                                                    {u.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </section>

                        <section className="space-y-3">
                            <h2 className="text-sm font-medium">
                                How often are you applying?
                            </h2>

                            <div className="flex gap-1.5">
                                {FREQUENCIES.map((f) => (
                                    <Choice
                                        key={f.id}
                                        on={frequency === f.id}
                                        onClick={() => setFrequency(f.id)}
                                        className="flex-1 justify-center text-center"
                                    >
                                        {f.label}
                                    </Choice>
                                ))}
                            </div>

                            {frequency === "custom" && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    Every
                                    <Input
                                        type="number"
                                        min={2}
                                        inputMode="numeric"
                                        value={everyN}
                                        aria-label="Days between logs"
                                        className="max-w-20"
                                        onChange={(e) =>
                                            setEveryN(e.target.value)
                                        }
                                    />
                                    days
                                </div>
                            )}
                        </section>

                        <StepFooter onBack={goBack} onNext={goNext} />
                    </div>
                );

            case "photo":
                return (
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <h2 className="text-sm font-medium">
                                AI Skin Analysis
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                Our AI will analyze this photo to score your
                                trouble areas, so we can see how much things
                                change down the line.
                            </p>
                        </div>

                        {cameraOpen ? (
                            <CameraCapture
                                onCapture={(file) => {
                                    setPhoto(file);
                                    setError(null);
                                    setCameraOpen(false);
                                }}
                                onCancel={() => setCameraOpen(false)}
                            />
                        ) : (
                            <Card className="items-center gap-3 p-5">
                                {preview ? (
                                    // eslint-disable-next-line @next/next/no-img-element -- a local
                                    // object URL, not a remote asset the Image loader could optimise.
                                    <img
                                        src={preview}
                                        alt="Your baseline capture"
                                        className="max-h-72 w-auto rounded-md object-contain"
                                    />
                                ) : (
                                    <div className="flex flex-col items-center gap-1 py-6 text-center">
                                        <Camera
                                            className="size-6 text-muted-foreground"
                                            aria-hidden
                                        />
                                        <p className="text-sm text-muted-foreground">
                                            No photo yet
                                        </p>
                                    </div>
                                )}

                                <Button
                                    size="lg"
                                    className="h-12 w-full px-6 text-base sm:h-9 sm:w-auto sm:px-2.5 sm:text-sm"
                                    onClick={() => setCameraOpen(true)}
                                >
                                    <Camera aria-hidden />
                                    {photo ? "Retake" : "Open camera"}
                                </Button>
                            </Card>
                        )}

                        {!photo && (
                            <p className="text-xs text-muted-foreground">
                                Take a photo to continue.
                            </p>
                        )}

                        <StepFooter
                            onBack={goBack}
                            onNext={goNext}
                            nextDisabled={!photo}
                        />
                    </div>
                );

            case "review":
                return (
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                                Review
                            </p>
                            <TitleEditor
                                value={name}
                                onChange={(next) => {
                                    setName(next);
                                    setNameTouched(true);
                                }}
                            />
                        </div>

                        <div className="grid gap-6 lg:grid-cols-[minmax(0,260px)_1fr] lg:items-start">
                            <div className="order-2 mx-auto w-full max-w-[260px] lg:order-none lg:col-start-1 lg:row-start-1 lg:row-span-2">
                                <Card className="items-center gap-0 overflow-hidden p-0">
                                    {preview ? (
                                        // eslint-disable-next-line @next/next/no-img-element -- a local
                                        // object URL, not a remote asset the Image loader could optimise.
                                        <img
                                            src={preview}
                                            alt="Your baseline capture"
                                            className="aspect-[3/4] w-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 text-center">
                                            <Camera
                                                className="size-6 text-muted-foreground"
                                                aria-hidden
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                No photo
                                            </p>
                                        </div>
                                    )}
                                </Card>
                            </div>

                            <div className="order-1 space-y-2 rounded-xl border p-4 text-sm lg:order-none lg:col-start-2 lg:row-start-1">
                                <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">
                                        Time of day
                                    </span>
                                    <span>
                                        {
                                            TIMES_OF_DAY.find(
                                                (t) => t.id === timeOfDay,
                                            )?.label
                                        }
                                    </span>
                                </div>
                                {trackProduct && (
                                    <div className="flex justify-between gap-4">
                                        <span className="text-muted-foreground">
                                            Product(s)
                                        </span>
                                        <span className="text-right">
                                            {items
                                                .filter((i) => i.name.trim())
                                                .map((i) => i.name)
                                                .join(", ") || "—"}
                                        </span>
                                    </div>
                                )}
                                {trackRoutine && (
                                    <div className="flex justify-between gap-4">
                                        <span className="text-muted-foreground">
                                            Routine
                                        </span>
                                        <span>
                                            {chosenRoutine?.name ?? "—"}
                                        </span>
                                    </div>
                                )}
                                <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">
                                        Duration
                                    </span>
                                    <span>
                                        {durationDays()
                                            ? `${durationDays()} days`
                                            : "Open-ended"}
                                    </span>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">
                                        Frequency
                                    </span>
                                    <span>
                                        {frequency === "custom"
                                            ? `Every ${everyN} days`
                                            : FREQUENCIES.find(
                                                  (f) => f.id === frequency,
                                              )?.label}
                                    </span>
                                </div>
                            </div>

                            <section className="order-3 space-y-3 lg:order-none lg:col-start-2 lg:row-start-2">
                                <h2 className="text-sm font-medium">
                                    Who can see this?
                                </h2>

                                <div className="flex gap-1.5">
                                    {VISIBILITIES.map((v) => (
                                        <Choice
                                            key={v.id}
                                            on={visibility === v.id}
                                            onClick={() =>
                                                setVisibility(v.id)
                                            }
                                            className="flex flex-1 items-center justify-center gap-1.5 py-2"
                                        >
                                            <v.icon className="size-3.5" />
                                            {v.label}
                                        </Choice>
                                    ))}
                                </div>

                                <p className="text-xs text-muted-foreground">
                                    You can change this at any time.
                                </p>
                            </section>
                        </div>

                        {error && (
                            <p role="alert" className="text-sm text-destructive">
                                {error}
                            </p>
                        )}

                        <div className="flex items-center justify-between pt-2">
                            <Button
                                variant="outline"
                                className={NAV_BUTTON_CLASS}
                                onClick={goBack}
                            >
                                <ChevronLeft aria-hidden />
                                Back
                            </Button>
                            <Button
                                className={NAV_BUTTON_CLASS}
                                onClick={save}
                                disabled={saving}
                            >
                                {saving && (
                                    <Loader2
                                        className="animate-spin"
                                        aria-hidden
                                    />
                                )}
                                {saving ? "Analysing your photo…" : "Save"}
                            </Button>
                        </div>
                    </div>
                );
        }
    }

    return (
        <Stepper value={activeStep} onValueChange={setActiveStep} className="space-y-8">
            <h1 className="text-xl font-semibold">New Trial</h1>

            <StepperNav>
                {steps.map((key, i) => {
                    const n = i + 1;
                    return (
                        <StepperItem key={key} step={n}>
                            <StepperTrigger className="flex-col items-center gap-2">
                                <StepperIndicator>{n}</StepperIndicator>
                                <StepperTitle className="text-sm font-medium">
                                    {STEP_LABELS[key]}
                                </StepperTitle>
                            </StepperTrigger>
                            {i < steps.length - 1 && (
                                <StepperSeparator className="self-start mt-3 sm:self-auto sm:mt-0" />
                            )}
                        </StepperItem>
                    );
                })}
            </StepperNav>

            <StepperPanel>
                {steps.map((key, i) => (
                    <StepperContent key={key} value={i + 1}>
                        {renderStep(key)}
                    </StepperContent>
                ))}
            </StepperPanel>
        </Stepper>
    );
}
