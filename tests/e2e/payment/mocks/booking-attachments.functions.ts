export async function getBookingAttachmentCapability() {
  return { enabled: false, reason: "upload_disabled" } as const;
}
