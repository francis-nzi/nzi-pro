import Link from "next/link";

export default function NotFound() {
  return (
    <div className="site-wrap page-hero">
      <p className="eyebrow">404</p>
      <h1>That page does not exist.</h1>
      <p className="lead">Use the navigation to return to the rebuilt site.</p>
      <div className="hero-actions">
        <Link href="/" className="btn btn-primary">
          Go home
        </Link>
      </div>
    </div>
  );
}
