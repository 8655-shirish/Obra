import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const planInquirySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Enter a valid email"),
  phone: z.string().trim().min(7, "Enter a valid phone number").max(30),
  city: z.string().trim().min(1, "City is required").max(200),
  plan: z.enum(["starter", "pro"]),
});

export const submitPlanInquiry = createServerFn({ method: "POST" })
  .validator((data: unknown) => planInquirySchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("plan_inquiries").insert({
      name: data.name,
      email: data.email,
      phone: data.phone,
      city: data.city,
      plan: data.plan,
    });

    if (error) {
      console.error("[submitPlanInquiry]", error);
      throw new Error("Unable to save your request. Please try again.");
    }

    return { success: true as const };
  });
