import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — OnceOver",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16 text-zinc-700">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
        &larr; Back to OnceOver
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900">Privacy Policy</h1>
      <p className="mt-2 text-sm text-zinc-500">Last updated September 2026.</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="font-semibold text-zinc-900">What OnceOver is</h2>
          <p className="mt-2">
            OnceOver lets someone (the &quot;sender&quot;) share a file through a link that expires
            after a time limit, a number of views, or both. This page covers what personal data is
            collected from senders and from the people they share files with (&quot;recipients&quot;
            or &quot;viewers&quot;).
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-zinc-900">If you create an account (senders)</h2>
          <p className="mt-2">
            Your email address and password are stored by Supabase, our authentication provider, to
            let you log in. We don&apos;t see or store your password ourselves. Files you upload are
            stored on Cloudflare R2 until they expire, are deleted by you, or reach their view limit
            — at which point the underlying file is permanently deleted from storage, not just hidden.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-zinc-900">If you open a shared file (recipients)</h2>
          <p className="mt-2">When you open a link someone shared with you, we record:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              The name or email address you enter to open it (or, for links restricted to specific
              recipients, the exact email address the link was shared with).
            </li>
            <li>Your IP address and browser user agent, at the time you open the file.</li>
            <li>The time you opened it and how long the viewing session stayed open.</li>
            <li>
              If you leave a comment or an approve/reject decision on the file, that text and your
              name.
            </li>
          </ul>
          <p className="mt-2">
            This information is shown only to the sender who shared the file with you, so they know
            who viewed it. Files are also watermarked with your identity and the time you opened
            them, directly on the page or image, so the source of a copy can be traced if it&apos;s
            shared further.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-zinc-900">One-time codes</h2>
          <p className="mt-2">
            For links restricted to specific email addresses, we email a one-time code to confirm you
            control that inbox before showing the file. That code expires after 10 minutes, can only
            be used once, and is sent via Resend, our email delivery provider.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-zinc-900">What we don&apos;t do</h2>
          <p className="mt-2">
            We don&apos;t sell or share this data with third parties for advertising, and we don&apos;t
            run analytics or advertising trackers on shared file links. Data is used only to operate
            the sharing and access-control features described above.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-zinc-900">Questions</h2>
          <p className="mt-2">
            If you have questions about data OnceOver holds about you, contact the person who sent
            you the file — they&apos;re the account holder and can request its removal.
          </p>
        </section>
      </div>
    </div>
  );
}
