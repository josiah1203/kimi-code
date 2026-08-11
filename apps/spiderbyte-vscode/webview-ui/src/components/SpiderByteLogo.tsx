import { useExtensionImageUrl } from "./hooks/useExtensionImageUrl";

export function SpiderByteLogo({ className }: { className?: string }) {
  const logoUrl = useExtensionImageUrl("spiderbyte-logo.png");

  if (!logoUrl) {
    return null;
  }

  return <img src={logoUrl} alt="SpiderByte" className={className} aria-label="SpiderByte" />;
}
