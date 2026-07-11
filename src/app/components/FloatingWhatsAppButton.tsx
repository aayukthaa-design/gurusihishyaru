import { useAuth } from '../auth/AuthContext';
import { WhatsAppButton } from './WhatsAppButton';
import { composeWhatsAppMessage, getWhatsAppBusinessName } from '../lib/whatsapp';

/** App-wide floating "Chat on WhatsApp" entry point, prefilled with the current user's details. */
export function FloatingWhatsAppButton() {
  const { user } = useAuth();

  const buildMessage = () =>
    composeWhatsAppMessage({
      greeting: getWhatsAppBusinessName(),
      intro: "I'm reaching out regarding your services.",
      sections: [[{ label: 'Name', value: user?.name }, { label: 'Email', value: user?.email }, { label: 'Phone', value: user?.mobile }]],
      closing: 'Please contact me. Thank you!',
    });

  return <WhatsAppButton variant="floating" message={buildMessage} label="Chat on WhatsApp" />;
}
