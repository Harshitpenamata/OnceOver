import Link from "next/link";

const FEATURES = [
  {
    title: "Expiry that actually expires",
    body: "Set a time window, a view limit, or both. When it's up, the file is permanently deleted from storage — not just hidden.",
  },
  {
    title: "Watermarked before it's ever shown",
    body: "The viewer's identity and timestamp are burned into the pixels server-side, so it survives cropping or screenshots.",
  },
  {
    title: "Know the instant it's opened",
    body: "Get notified the moment your file is viewed, plus a full log of who opened it and when.",
  },
  {
    title: "Approve, reject, discuss",
    body: "Recipients can approve or reject on open, and a threaded comment section keeps the whole conversation with the file.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-white">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <span className="text-lg font-semibold tracking-tight text-zinc-900">OnceOver</span>
        <nav className="flex gap-3 text-sm">
          <Link href="/login" className="px-3 py-2 text-zinc-600 hover:text-zinc-900">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700"
          >
            Sign up
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-20 text-center">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
          Send files that don&apos;t stick around.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-zinc-500">
          Watermarked, time-boxed, view-limited sharing for concept art, scripts, pitch decks, and
          contracts. Know exactly who saw it, and when.
        </p>
        <Link
          href="/signup"
          className="mt-8 rounded-lg bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Get started free
        </Link>

        <div className="mt-24 grid w-full grid-cols-1 gap-6 text-left sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-zinc-200 p-6">
              <h3 className="font-semibold text-zinc-900">{f.title}</h3>
              <p className="mt-2 text-sm text-zinc-500">{f.body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-zinc-200 py-6 text-center text-sm text-zinc-400">
        Built for freelance designers, production houses, and studios who need control over who
        sees what, for how long.
      </footer>
    </div>
  );
}
