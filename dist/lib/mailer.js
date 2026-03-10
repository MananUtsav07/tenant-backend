import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASS,
    },
});
export async function sendOwnerTicketNotification(payload) {
    const propertyLabel = payload.propertyName?.trim() || 'Not provided';
    const unitLabel = payload.unitNumber?.trim() || 'Not provided';
    await transporter.sendMail({
        from: env.EMAIL_USER,
        to: payload.to,
        subject: `Tenant Ticket: ${payload.subject}`,
        text: [
            `Hello ${payload.ownerName},`,
            '',
            'A tenant raised a support ticket.',
            `Tenant: ${payload.tenantName} (${payload.tenantAccessId})`,
            `Property: ${propertyLabel}`,
            `Unit: ${unitLabel}`,
            `Subject: ${payload.subject}`,
            `Message: ${payload.message}`,
            '',
            'Please log in to your owner dashboard to respond.',
        ].join('\n'),
    });
}
export async function sendPublicContactNotification(payload) {
    await transporter.sendMail({
        from: env.EMAIL_USER,
        to: payload.to,
        subject: `New public contact message from ${payload.name}`,
        text: [
            'A new contact request was submitted from the website.',
            '',
            `Name: ${payload.name}`,
            `Email: ${payload.email}`,
            `Submitted At: ${payload.createdAt}`,
            '',
            'Message:',
            payload.message,
        ].join('\n'),
    });
}
//# sourceMappingURL=mailer.js.map