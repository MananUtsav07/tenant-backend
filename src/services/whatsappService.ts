export async function sendWhatsappReminderStub(input: {
  to: string
  tenantName: string
  message: string
}) {
  // Future integration point for WhatsApp API provider.
  console.log('[whatsapp-stub] reminder queued', {
    to: input.to,
    tenantName: input.tenantName,
    messagePreview: input.message.slice(0, 80),
  })
}