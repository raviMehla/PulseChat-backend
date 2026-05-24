
import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const sendMessageSchema = z.object({
  replyTo: z.string()
    .refine(val => val === "" || objectIdRegex.test(val), {
      message: "Invalid replyTo ID format"
    })
    .nullable()
    .optional()
    .transform(val => val === "" ? null : val)
});

const testCases = [
  { replyTo: undefined },
  { replyTo: null },
  { replyTo: "" },
  { replyTo: "123456789012123456789012" }, // valid hex
  { replyTo: "undefined" },
  { replyTo: "null" },
  { replyTo: "123" }
];

for (const tc of testCases) {
  const res = sendMessageSchema.safeParse(tc);
  console.log(`Input: ${JSON.stringify(tc)} -> Success: ${res.success}, Data: ${JSON.stringify(res.data)}, Error: ${res.error?.issues[0]?.message}`);
}
