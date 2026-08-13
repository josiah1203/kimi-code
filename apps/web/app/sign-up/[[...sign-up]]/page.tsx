import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="clerk-host">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </main>
  );
}
