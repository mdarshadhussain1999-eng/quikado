export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated: March 2026
        </p>

        <div className="mt-8 space-y-8 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="text-lg font-medium text-foreground">1. What Quikado does</h2>
            <p className="mt-2">
              Quikado is a marketplace that helps users find service providers and
              helps providers offer services. The platform supports typed input,
              limited in-app chat, and optional contact sharing.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">2. Information we collect</h2>
            <p className="mt-2">
              We may collect information such as your name, email address, login
              details, search requests, offered services, limited in-app messages,
              moderation logs, usage activity, and payment-related records.
            </p>
            <p className="mt-2">
              If you use audio features, we may process audio uploads and their
              transcripts to support search, moderation, and service matching.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">3. Why we collect information</h2>
            <p className="mt-2">
              We use information to operate the platform, create matches, prevent
              misuse, enforce safety rules, support payments and credits, improve
              service quality, and respond to support issues.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">4. Safety and moderation</h2>
            <p className="mt-2">
              Quikado may review or block requests, services, transcripts, or
              messages that appear illegal, unsafe, abusive, or suspicious. Some
              content may enter a review queue before it becomes visible or is
              delivered.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">5. Contact sharing</h2>
            <p className="mt-2">
              Quikado allows optional contact sharing such as WhatsApp number or
              email after limited chat usage. You should share contact details only
              if you are comfortable doing so.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">6. Payments and credits</h2>
            <p className="mt-2">
              Credits may be used for certain features on the platform. Payments are
              processed through third-party payment providers. Quikado does not store
              full card details.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">7. Third-party services</h2>
            <p className="mt-2">
              Quikado may rely on third-party services for authentication, hosting,
              database infrastructure, payments, analytics, audio processing, and AI
              features. Their handling of data may also be subject to their own
              policies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">8. Data retention</h2>
            <p className="mt-2">
              We retain information for as long as reasonably necessary to operate
              the service, comply with legal obligations, resolve disputes, and
              maintain safety logs. Some deleted chat content may remain in logs or
              backups for a limited time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">9. Your choices</h2>
            <p className="mt-2">
              You may stop using the platform at any time. You may also choose
              whether to share contact information and whether to continue certain
              conversations outside the platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">10. Contact</h2>
            <p className="mt-2">
              For privacy or support questions, please use the Help page or the
              official support email/contact method that Quikado publishes.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}