export default function HelpPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Help</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Quikado support and platform guidance
        </p>

        <div className="mt-8 space-y-8 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="text-lg font-medium text-foreground">How Quikado works</h2>
            <p className="mt-2">
              In Find mode, you describe the service you need and Quikado shows
              relevant matches. In Offer mode, you describe the service you provide
              so seekers can find you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">Credits</h2>
            <p className="mt-2">
              Some actions on Quikado may use credits, such as paid searches after
              free daily usage or unlocking conversations. Credits help support
              infrastructure, moderation, and platform operations.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">Chat and contact sharing</h2>
            <p className="mt-2">
              Quikado provides limited in-app messaging. After limited messages,
              users may choose to continue via WhatsApp or email if they are
              comfortable sharing contact details.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">Safety rules</h2>
            <p className="mt-2">
              Illegal, unsafe, abusive, or suspicious requests and services are not
              allowed. Some submissions may be blocked automatically and some may go
              into review before they are visible or delivered.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">Common issues</h2>
            <div className="mt-3 space-y-3">
              <div>
                <div className="font-medium text-foreground">No matches found</div>
                <p className="mt-1">
                  Try using clearer wording, adding filters such as location or
                  category, or describing the service more specifically.
                </p>
              </div>

              <div>
                <div className="font-medium text-foreground">Search needs credits</div>
                <p className="mt-1">
                  Quikado allows limited free daily searches. After that, paid
                  searches may require credits.
                </p>
              </div>

              <div>
                <div className="font-medium text-foreground">A submission is under review</div>
                <p className="mt-1">
                  Some content may be delayed if it appears ambiguous or potentially
                  unsafe. You can try rewriting it more clearly.
                </p>
              </div>

              <div>
                <div className="font-medium text-foreground">Chat is locked</div>
                <p className="mt-1">
                  Quikado limits in-app messages for safety reasons. You may be able
                  to continue via WhatsApp or email if both sides choose to do so.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium text-foreground">Support contact</h2>
            <p className="mt-2">
              Reach admin@quikado.com for any kind of querry, our official support email.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}