import { UserProfile } from "@clerk/nextjs";

export default function AccountPage() {
  return (
    <main className="clerk-host">
      <UserProfile routing="path" path="/account" />
    </main>
  );
}
