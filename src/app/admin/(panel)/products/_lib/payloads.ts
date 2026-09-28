import { z } from "zod";

/**
 * JSON payloads posted by the product editor's client managers
 * (options, add-ons, images). Client-safe: types are shared with the UI.
 */

export const REQUIRED_OVERRIDE = ["inherit", "required", "optional"] as const;
export type RequiredOverride = (typeof REQUIRED_OVERRIDE)[number];

export const optionValueStateSchema = z.object({
  optionValueId: z.string().min(1).max(64),
  enabled: z.boolean(),
  priceOverride: z.string().max(20),
  displayOrderOverride: z.string().max(10),
  isDefault: z.boolean(),
});

export const optionGroupStateSchema = z.object({
  optionGroupId: z.string().min(1).max(64),
  requiredOverride: z.enum(REQUIRED_OVERRIDE),
  displayNameOverride: z.string().max(120),
  values: z.array(optionValueStateSchema).max(500),
});

export const optionsPayloadSchema = z.array(optionGroupStateSchema).max(100);
export type OptionGroupState = z.infer<typeof optionGroupStateSchema>;
export type OptionValueState = z.infer<typeof optionValueStateSchema>;

export const addOnStateSchema = z.object({
  addOnId: z.string().min(1).max(64),
  enabled: z.boolean(),
  priceOverride: z.string().max(20),
  requiredOverride: z.enum(REQUIRED_OVERRIDE),
  minQuantityOverride: z.string().max(10),
  maxQuantityOverride: z.string().max(10),
});

export const addOnsPayloadSchema = z.array(addOnStateSchema).max(200);
export type AddOnState = z.infer<typeof addOnStateSchema>;

export const imagesPayloadSchema = z
  .array(
    z.object({
      mediaId: z.string().min(1).max(64),
      alt: z.string().max(300),
      isPrimary: z.boolean(),
    }),
  )
  .max(500);
export type ImageState = z.infer<typeof imagesPayloadSchema>[number];

export function toRequiredOverride(v: RequiredOverride): boolean | null {
  return v === "inherit" ? null : v === "required";
}

export function fromRequiredOverride(v: boolean | null): RequiredOverride {
  return v == null ? "inherit" : v ? "required" : "optional";
}
