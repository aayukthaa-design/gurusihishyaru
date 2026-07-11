import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { WhatsAppIcon } from './icons/WhatsAppIcon';
import { buildWhatsAppUrl, getDefaultWhatsAppPhone } from '../lib/whatsapp';

export type WhatsAppButtonVariant = 'solid' | 'outline' | 'floating';

export interface WhatsAppButtonProps {
  /** Target number for this chat. Falls back to VITE_WHATSAPP_PHONE when omitted. */
  phone?: string;
  /** The prefilled message. Pass a (sync or async) function if it needs data prepared first. */
  message: string | (() => string) | (() => Promise<string>);
  label?: string;
  className?: string;
  variant?: WhatsAppButtonVariant;
}

const VARIANT_CLASSES: Record<WhatsAppButtonVariant, string> = {
  solid: 'bg-[#25D366] px-4 py-2.5 text-sm text-white shadow-sm hover:bg-[#1FBF5C]',
  outline:
    'border border-[#25D366] px-2.5 py-1.5 text-xs font-medium text-[#128C4A] hover:bg-[#25D366]/10 dark:text-[#25D366]',
  floating:
    'fixed bottom-6 right-6 z-50 h-14 w-14 justify-center rounded-full bg-[#25D366] text-white shadow-lg hover:bg-[#1FBF5C] hover:scale-105',
};

/**
 * Renders a "Chat on WhatsApp" button that opens https://wa.me with a prefilled,
 * editable message. Never sends anything itself — the user reviews and taps Send
 * inside WhatsApp. No Business API or backend call is involved.
 */
export function WhatsAppButton({ phone, message, label = 'Chat on WhatsApp', className = '', variant = 'solid' }: WhatsAppButtonProps) {
  const [isPreparing, setIsPreparing] = useState(false);

  const handleClick = async () => {
    const targetPhone = phone ?? getDefaultWhatsAppPhone();
    if (!targetPhone) {
      console.error('WhatsApp phone number is not configured (VITE_WHATSAPP_PHONE).');
      return;
    }

    let resolvedMessage: string;
    if (typeof message === 'function') {
      setIsPreparing(true);
      try {
        resolvedMessage = await message();
      } finally {
        setIsPreparing(false);
      }
    } else {
      resolvedMessage = message;
    }

    window.open(buildWhatsAppUrl(targetPhone, resolvedMessage), '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPreparing}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {isPreparing ? (
        <Loader2 className={variant === 'floating' ? 'h-6 w-6 animate-spin' : 'h-4 w-4 animate-spin'} />
      ) : (
        <WhatsAppIcon className={variant === 'floating' ? 'h-7 w-7' : 'h-4 w-4'} />
      )}
      {variant !== 'floating' && <span>{isPreparing ? 'Preparing…' : label}</span>}
    </button>
  );
}
