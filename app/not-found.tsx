import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p className="muted">
        That page does not exist. <Link href="/">Back to the subreddit list</Link>.
      </p>
    </>
  );
}
