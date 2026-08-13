import { OrganizationProfile } from "@clerk/nextjs";

export default function OrganizationPage() {
  return (
    <main className="clerk-host">
      <OrganizationProfile routing="path" path="/organization" />
    </main>
  );
}
