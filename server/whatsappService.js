/**
 * WhatsApp Provider Abstraction base class.
 */
export class WhatsAppProvider {
  /**
   * Send a WhatsApp message
   * @param {Object} config - Provider credentials and settings
   * @param {Object} messageData - Recipient and dynamic placeholders
   * @returns {Promise<{success: boolean, status: string, error?: string, messageId?: string}>}
   */
  async sendMessage(config, messageData) {
    throw new Error('Method sendMessage must be implemented');
  }
}

/**
 * Reusable WhatsApp Message templates with placeholders:
 * {{StudentName}}, {{Class}}, {{Branch}}, {{AttendanceDate}}, {{TutorialName}}, {{OfficialContact}},
 * {{Subject}}, {{TeacherName}}, {{HomeworkTitle}}, {{DueDate}}
 */
export const DEFAULT_TEMPLATES = {
  attendance_absence_alert: `📢 *{{TutorialName}}*

Dear Parent,

This is to inform you that your ward *{{StudentName}}* studying in *{{Class}}* has been marked *ABSENT* for today's class.

📅 Date:
{{AttendanceDate}}

If this absence was unexpected, kindly contact the tutorial for clarification.

📞 Contact:
{{OfficialContact}}

Thank you.

*{{TutorialName}}*`,

  homework_update_alert: `📚 *{{TutorialName}}*

Dear Parent,

Homework for *{{Class}}* — *{{Subject}}* has been updated by *{{TeacherName}}*.

📝 Title: {{HomeworkTitle}}
📅 Due Date: {{DueDate}}

Please check the app for full details.

📞 Contact:
{{OfficialContact}}

Thank you.

*{{TutorialName}}*`,

  parent_login_otp: `🔐 *{{TutorialName}}*

Your login verification code is: *{{OtpCode}}*

This code expires in {{OtpExpiryMinutes}} minutes. Do not share this code with anyone.

If you did not request this, please ignore this message.`
};

/**
 * Dynamically replace template placeholders with message parameters
 */
export function fillTemplate(templateText, data) {
  const tutorialName = data.tutorialName || data.businessName || 'Guru Shishyaru Tutorials';
  const branchName = data.branchName || '';

  return templateText
    .replace(/\{\{StudentName\}\}/g, data.studentName || '')
    .replace(/\{\{Class\}\}/g, data.className || '')
    .replace(/\{\{Branch\}\}/g, branchName)
    .replace(/\{\{AttendanceDate\}\}/g, data.attendanceDate || '')
    .replace(/\{\{TutorialName\}\}/g, tutorialName)
    .replace(/\{\{OfficialContact\}\}/g, data.officialContact || '')
    .replace(/\{\{Subject\}\}/g, data.subject || '')
    .replace(/\{\{TeacherName\}\}/g, data.teacherName || '')
    .replace(/\{\{HomeworkTitle\}\}/g, data.homeworkTitle || '')
    .replace(/\{\{DueDate\}\}/g, data.dueDate || '')
    .replace(/\{\{OtpCode\}\}/g, data.otpCode || '')
    .replace(/\{\{OtpExpiryMinutes\}\}/g, data.otpExpiryMinutes || '5');
}

/**
 * Mock Provider for local development, simulation and testing.
 */
export class MockWhatsAppProvider extends WhatsAppProvider {
  async sendMessage(config, messageData) {
    const templateText = DEFAULT_TEMPLATES[config.templateName || 'attendance_absence_alert'] || DEFAULT_TEMPLATES.attendance_absence_alert;
    const message = fillTemplate(templateText, messageData);

    console.log(`[MockWhatsAppProvider] Simulating successful dispatch to ${messageData.to}`);
    console.log(`[Mock Payload]:\n${message}`);

    // Simulate async network delay
    await new Promise(resolve => setTimeout(resolve, 200));

    return { success: true, status: 'Simulated Sent' };
  }
}

/**
 * Concrete Meta Cloud API Provider (Ready for production)
 */
// Template body parameters for providers that use pre-approved WhatsApp Business
// templates (Meta Cloud API, Interakt) are positional ({{1}}, {{2}}...) and must
// match the order the template was approved with — there is no name-based
// substitution on the provider's side (that only happens locally in
// fillTemplate() for Mock/Twilio/Gupshup). Each templateName maps to the exact
// field order its approved template expects; messageData.templateParams can
// override this directly for a template not listed here.
const TEMPLATE_PARAM_ORDER = {
  attendance_absence_alert: ['studentName', 'className', 'attendanceDate', 'officialContact'],
  homework_update_alert: ['className', 'subject', 'teacherName', 'homeworkTitle', 'dueDate', 'officialContact'],
  // Meta requires OTP/verification messages to use a template in the
  // "Authentication" category — when creating this template in WhatsApp
  // Manager, its single body variable is the code itself.
  parent_login_otp: ['otpCode'],
};

export class MetaWhatsAppProvider extends WhatsAppProvider {
  async sendMessage(config, messageData) {
    const { to } = messageData;
    const { apiToken, phoneNumberId, templateName, apiVersion } = config;
    const version = apiVersion || 'v17.0';
    const resolvedTemplateName = templateName || 'attendance_absence_alert';

    const paramOrder = TEMPLATE_PARAM_ORDER[resolvedTemplateName] || TEMPLATE_PARAM_ORDER.attendance_absence_alert;
    const templateParams = messageData.templateParams || paramOrder.map((field) => messageData[field] || '');

    console.log(`[MetaWhatsAppProvider] Generating Meta API template call for ${to}...`);
    console.log(`[Meta Cloud API Payload]:
      POST https://graph.facebook.com/${version}/${phoneNumberId || 'phone_id'}/messages
      Headers: {
        "Authorization": "Bearer ${apiToken ? apiToken.substring(0, 8) + '...' : 'none'}",
        "Content-Type": "application/json"
      }
      Body: {
        "messaging_product": "whatsapp",
        "to": "${to}",
        "type": "template",
        "template": {
          "name": "${resolvedTemplateName}",
          "language": { "code": "en" },
          "components": [
            {
              "type": "body",
              "parameters": ${JSON.stringify(templateParams.map((p) => ({ type: 'text', text: p })))}
            }
          ]
        }
      }
    `);

    // Actual integration call
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to,
          type: 'template',
          template: {
            name: resolvedTemplateName,
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: templateParams.map((p) => ({ type: 'text', text: p }))
              }
            ]
          }
        })
      });

      const json = await res.json();
      if (res.ok) {
        return { success: true, status: 'Sent', messageId: json.messages?.[0]?.id };
      } else {
        return { success: false, status: 'Failed', error: json.error?.message || 'Meta API Error' };
      }
    } catch (err) {
      return { success: false, status: 'Failed', error: err.message };
    }
  }
}

/**
 * Concrete Twilio WhatsApp Provider
 */
export class TwilioWhatsAppProvider extends WhatsAppProvider {
  async sendMessage(config, messageData) {
    const { to, officialContact } = messageData;
    const { apiToken, businessAccountId, templateName } = config; // Twilio uses authToken and accountSid

    const templateText = DEFAULT_TEMPLATES[templateName || 'attendance_absence_alert'] || DEFAULT_TEMPLATES.attendance_absence_alert;
    const message = fillTemplate(templateText, messageData);

    console.log(`[TwilioWhatsAppProvider] Generating Twilio WhatsApp call for ${to}...`);
    console.log(`[Twilio Payload]:
      POST https://api.twilio.com/2010-04-01/Accounts/${businessAccountId || 'sid'}/Messages.json
      From: whatsapp:${officialContact}
      To: whatsapp:${to}
      Body: ${message.replace(/\n/g, '\\n')}
    `);

    try {
      const auth = Buffer.from(`${businessAccountId}:${apiToken}`).toString('base64');
      const body = new URLSearchParams();
      body.append('From', `whatsapp:${officialContact}`);
      body.append('To', `whatsapp:${to}`);
      body.append('Body', message);

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${businessAccountId}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      const json = await res.json();
      if (res.ok) {
        return { success: true, status: 'Sent', messageId: json.sid };
      } else {
        return { success: false, status: 'Failed', error: json.message || 'Twilio API Error' };
      }
    } catch (err) {
      return { success: false, status: 'Failed', error: err.message };
    }
  }
}

/**
 * Concrete Gupshup WhatsApp Provider
 */
export class GupshupWhatsAppProvider extends WhatsAppProvider {
  async sendMessage(config, messageData) {
    const { to, officialContact } = messageData;
    const { apiToken, templateName } = config;

    const templateText = DEFAULT_TEMPLATES[templateName || 'attendance_absence_alert'] || DEFAULT_TEMPLATES.attendance_absence_alert;
    const message = fillTemplate(templateText, messageData);

    console.log(`[GupshupWhatsAppProvider] Generating Gupshup call for ${to}...`);

    try {
      const body = new URLSearchParams();
      body.append('channel', 'whatsapp');
      body.append('source', officialContact);
      body.append('destination', to);
      body.append('message', JSON.stringify({ type: 'text', text: message }));

      const res = await fetch('https://api.gupshup.io/sm/api/v1/msg', {
        method: 'POST',
        headers: {
          'apikey': apiToken,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      const json = await res.json();
      if (res.ok) {
        return { success: true, status: 'Sent', messageId: json.messageId };
      } else {
        return { success: false, status: 'Failed', error: json.error || 'Gupshup API Error' };
      }
    } catch (err) {
      return { success: false, status: 'Failed', error: err.message };
    }
  }
}

/**
 * Concrete Interakt WhatsApp Provider
 */
export class InteraktWhatsAppProvider extends WhatsAppProvider {
  async sendMessage(config, messageData) {
    const { to } = messageData;
    const { apiToken, templateName } = config;
    const resolvedTemplateName = templateName || 'attendance_absence_alert';

    const paramOrder = TEMPLATE_PARAM_ORDER[resolvedTemplateName] || TEMPLATE_PARAM_ORDER.attendance_absence_alert;
    const templateParams = messageData.templateParams || paramOrder.map((field) => messageData[field] || '');

    console.log(`[InteraktWhatsAppProvider] Generating Interakt call for ${to}...`);

    try {
      const res = await fetch('https://api.interakt.ai/v1/public/message/', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          countryCode: '+91',
          phoneNumber: to,
          callbackData: 'attendance_alert',
          type: 'Template',
          template: {
            name: resolvedTemplateName,
            languageCode: 'en',
            bodyValues: templateParams
          }
        })
      });

      const json = await res.json();
      if (res.ok) {
        return { success: true, status: 'Sent', messageId: json.id };
      } else {
        return { success: false, status: 'Failed', error: json.message || 'Interakt API Error' };
      }
    } catch (err) {
      return { success: false, status: 'Failed', error: err.message };
    }
  }
}

/**
 * Unified interface orchestrator.
 */
export class WhatsAppService {
  /**
   * Factory method returning the active WhatsApp Provider based on configuration
   */
  static getProvider(providerName, config) {
    const apiToken = config.apiToken || '';
    
    // Fallback rule: if credentials are empty or look like placeholder/example tokens,
    // continue using MockWhatsAppProvider. 'EAAG3yZCbKvZCoBA' is NOT a real credential —
    // it's the fixed prefix Meta's own dashboard shows in its example/sample token text,
    // so this just catches someone pasting that example verbatim instead of a real token.
    const hasCredentials = apiToken &&
                           apiToken.trim() !== '' &&
                           apiToken !== 'dummy_token_123456' &&
                           !apiToken.includes('EAAG3yZCbKvZCoBA');

    if (providerName === 'Mock' || !providerName || !hasCredentials) {
      return new MockWhatsAppProvider();
    }

    switch (providerName) {
      case 'WhatsApp Business Cloud API':
      case 'Meta WhatsApp Business API':
        return new MetaWhatsAppProvider();
      case 'Twilio WhatsApp':
        return new TwilioWhatsAppProvider();
      case 'Gupshup':
        return new GupshupWhatsAppProvider();
      case 'Interakt':
        return new InteraktWhatsAppProvider();
      default:
        return new MockWhatsAppProvider();
    }
  }

  /**
   * Delegates sending to the resolved provider
   */
  static async sendMessage(providerName, config, messageData) {
    const provider = this.getProvider(providerName, config);
    return await provider.sendMessage(config, messageData);
  }
}
