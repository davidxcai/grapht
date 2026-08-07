"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
    Camera,
    ImageUp,
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ConcernChips } from "@/components/concern-chips";
import { ConcernPicker } from "@/components/concern-picker";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { orderConcerns } from "@/lib/concerns";
import { suggestConcerns, type Suggestion } from "@/app/routines/actions";
import { startTrial } from "@/app/trials/actions";
import type { Provenance, RankedConcern } from "@/lib/routines";
import type { Frequency, TimeOfDay, TrialVisibility } from "@/lib/trials";

export interface RoutineOption {
    id: string;
    name: string;
    coverage: string[];
    products: string[];
}

interface Draft {
    key: string;
    brand: string;
    name: string;
    dosage: string;
    targets: string[];
    ranked: RankedConcern[];
    classifier: { model: string; promptVersion: string } | null;
    productKey: string | null;
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
    key: `tracked-${(seq += 1)}`,
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
});

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

const TIMES_OF_DAY: { id: TimeOfDay; label: string; icon: typeof Sun }[] = [
    { id: "am", label: "AM", icon: Sun },
    { id: "pm", label: "PM", icon: Moon },
];

/** Private is first and is the default; publishing is never the fallback. */
const VISIBILITIES: {
    id: TrialVisibility;
    label: string;
    icon: typeof Sun;
}[] = [
    { id: "private", label: "Private", icon: Lock },
    { id: "public", label: "Public", icon: Users },
];

/** The chosen routine, showing what a routine card shows. */
function RoutineSummary({ routine }: { routine: RoutineOption }) {
    return (
        <div className="flex w-full flex-col gap-3 rounded-xl bg-card p-4 text-sm text-card-foreground ring-1 ring-foreground/10">
            <div className="flex items-center justify-between gap-3">
                <h3 className="truncate text-sm font-medium">{routine.name}</h3>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {routine.products.length}{" "}
                    {routine.products.length === 1 ? "product" : "products"}
                </span>
            </div>

            {routine.products.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">
                    {routine.products.join(" · ")}
                </p>
            )}

            <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Covers</p>
                <ConcernChips
                    concerns={routine.coverage}
                    empty="No metrics tagged"
                />
            </div>
        </div>
    );
}

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

export function TrialEditor({
    routines,
    routinesError,
}: {
    routines: RoutineOption[];
    routinesError: string | null;
}) {
    const router = useRouter();

    const [items, setItems] = useState<Draft[]>([blank()]);
    const [name, setName] = useState("");
    const [nameTouched, setNameTouched] = useState(false);

    const [withRoutine, setWithRoutine] = useState(false);
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
    const fileInput = useRef<HTMLInputElement>(null);

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

    const patch = (key: string, change: Partial<Draft>) =>
        setItems((prev) =>
            prev.map((i) => (i.key === key ? { ...i, ...change } : i)),
        );

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
                    interventions: items
                        .filter((i) => i.name.trim())
                        .map((i) => ({
                            brand: i.brand.trim() || null,
                            name: i.name.trim(),
                            dosage: i.dosage.trim() || null,
                            targets: i.targets,
                            ranked: i.ranked,
                            provenance: provenanceOf(i),
                            classifier: i.classifier,
                            productKey: i.productKey,
                        })),
                    routineId,
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
            router.push(`/trials/${result.data.id}`);
            router.refresh();
        });
    }

    const tracking = orderConcerns(items.flatMap((i) => i.targets));
    const chosenRoutine = routines.find((r) => r.id === routineId) ?? null;

    return (
        <div className="space-y-8">
            {/* ---- tracked products ---- */}
            <section className="space-y-3">
                <TitleEditor
                    value={name}
                    onChange={(next) => {
                        setName(next);
                        setNameTouched(true);
                    }}
                />

                <div className="space-y-4 my-6">
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
                <Separator />

                <h2 className="text-sm font-medium">Product(s)</h2>

                {items.map((item) => (
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
                                    placeholder="Product, e.g. azelaic acid 10%"
                                    aria-label="Product name"
                                    onChange={(e) =>
                                        patch(item.key, {
                                            name: e.target.value,
                                        })
                                    }
                                />
                            </div>

                            {items.length > 1 && (
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Remove product"
                                    className="shrink-0"
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
                            )}
                        </div>

                        {/* Free text on purpose: "2 pumps", "pea-sized", "20 mg"
                            are all legitimate and no unit picker fits them all. */}
                        <Input
                            value={item.dosage}
                            placeholder="Amount per use (optional), e.g. 2 pumps"
                            aria-label="Amount per use"
                            onChange={(e) =>
                                patch(item.key, {
                                    dosage: e.target.value,
                                })
                            }
                        />

                        <ConcernPicker
                            targets={item.targets}
                            ranked={item.ranked}
                            busy={item.busy}
                            note={item.note}
                            label="What you want to watch"
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
                    Add own
                </Button>
            </section>

            <Separator />

            {/* ---- baseline routine ---- */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label
                        htmlFor="add-routine"
                        className="text-sm font-medium"
                    >
                        Use Routine
                    </Label>
                    <Switch
                        id="add-routine"
                        checked={withRoutine}
                        onCheckedChange={(on: boolean) => {
                            setWithRoutine(on);
                            if (!on) setRoutineId(null);
                        }}
                    />
                </div>

                {withRoutine &&
                    (routinesError ? (
                        <p className="text-xs text-muted-foreground">
                            Saved routines are unavailable — {routinesError}
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
                                            routines.find((r) => r.id === value)
                                                ?.name ?? "Choose a routine"
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
                                <RoutineSummary routine={chosenRoutine} />
                            )}
                        </>
                    ))}
            </section>

            <Separator />

            {/* ---- duration ---- */}
            <section className="space-y-3">
                <h2 className="text-sm font-medium">
                    How long are we tracking?
                </h2>

                <div className="flex gap-1.5">
                    {DURATIONS.map((d) => (
                        <Choice
                            key={d}
                            on={durationMode === "preset" && presetDays === d}
                            onClick={() => {
                                setDurationMode("preset");
                                setPresetDays(d);
                            }}
                            className="flex-1 justify-center text-center"
                        >
                            {d} days
                        </Choice>
                    ))}

                    {claimDays !== null && !DURATIONS.includes(claimDays) && (
                        <Choice
                            on={durationMode === "claim"}
                            onClick={() => setDurationMode("claim")}
                            className="flex-1 justify-center text-center"
                        >
                            {claimDays} days — the label&rsquo;s claim
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
                            onChange={(e) => setCustomDays(e.target.value)}
                        />
                        <Select
                            value={customUnit}
                            onValueChange={(next: unknown) =>
                                setCustomUnit(next as DurationUnit)
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
                                    <SelectItem key={u.id} value={u.id}>
                                        {u.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </section>

            <Separator />

            {/* ---- frequency ---- */}
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
                            onChange={(e) => setEveryN(e.target.value)}
                        />
                        days
                    </div>
                )}
            </section>

            <Separator />

            {/* ---- baseline photo ---- */}
            <section className="space-y-3">
                <h2 className="text-sm font-medium">First Photo</h2>

                <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="sr-only"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) {
                            setPhoto(file);
                            setError(null);
                            setCameraOpen(false);
                        }
                    }}
                />

                {cameraOpen ? (
                    <CameraCapture
                        onCapture={(file) => {
                            setPhoto(file);
                            setError(null);
                            setCameraOpen(false);
                        }}
                        onCancel={() => setCameraOpen(false)}
                        onUpload={() => fileInput.current?.click()}
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
                                <ImageUp
                                    className="size-6 text-muted-foreground"
                                    aria-hidden
                                />
                                <p className="text-sm text-muted-foreground">
                                    No photo yet
                                </p>
                            </div>
                        )}

                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                onClick={() => setCameraOpen(true)}
                            >
                                <Camera aria-hidden />
                                Open camera
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fileInput.current?.click()}
                            >
                                Upload photo
                            </Button>
                        </div>
                    </Card>
                )}
            </section>

            <Separator />

            {/* ---- visibility ---- */}
            <section className="space-y-3">
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
                        ? "The community can watch this trial as it runs. You can make it private again at any time."
                        : "Only you can see this trial. You can share it with the community at any time."}
                </p>
            </section>

            <Separator />

            {/* ---- commit ---- */}
            <section className="space-y-4">
                {error && (
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                )}

                <Button className="w-full" onClick={save} disabled={saving}>
                    {saving && <Loader2 className="animate-spin" aria-hidden />}
                    {saving ? "Analysing your photo…" : "Save"}
                </Button>
            </section>
        </div>
    );
}
