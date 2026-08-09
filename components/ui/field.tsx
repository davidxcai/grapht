import * as React from "react"
import { Field as FieldPrimitive } from "@base-ui/react/field"
import { cn } from "@/lib/utils"

const Field = React.forwardRef<
  React.ElementRef<typeof FieldPrimitive>,
  React.ComponentPropsWithoutRef<typeof FieldPrimitive>
>(({ className, ...props }, ref) => (
  <FieldPrimitive
    ref={ref}
    className={cn("flex items-center gap-3", className)}
    {...props}
  />
))
Field.displayName = "Field"

const FieldLabel = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("flex cursor-pointer items-center gap-3", className)}
    {...props}
  />
))
FieldLabel.displayName = "FieldLabel"

const FieldContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1", className)}
    {...props}
  />
))
FieldContent.displayName = "FieldContent"

const FieldTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm font-medium leading-none", className)}
    {...props}
  />
))
FieldTitle.displayName = "FieldTitle"

const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
))
FieldDescription.displayName = "FieldDescription"

export {
  Field,
  FieldLabel,
  FieldContent,
  FieldTitle,
  FieldDescription,
}
