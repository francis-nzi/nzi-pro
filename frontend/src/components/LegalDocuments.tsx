import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const termsSummary = [
  ["Scope of Services", "Services are provided with reasonable skill and care in accordance with the agreed scope, assumptions and timetable."],
  ["Client Responsibilities", "Clients must provide accurate, complete and timely information, records, access and instructions required for the engagement."],
  ["Reliance on Information", "NZI may rely on information supplied by the Client or third parties unless independent verification is expressly included in scope."],
  ["Use of Deliverables", "Deliverables are provided for the Client's internal business purposes only and may not be relied on by third parties without NZI's prior written consent."],
  ["Intellectual Property", "NZI retains ownership of its methodologies, tools, templates, software and underlying intellectual property. Clients receive a non-exclusive licence to use deliverables internally, subject to payment in full."],
  ["Confidentiality", "Each party shall keep the other's confidential information confidential, except where disclosure is required by law or reasonably necessary for professional advisers, insurers or subcontractors."],
  ["Data Protection", "Depending on the nature of the services, NZI may act as controller, processor or separate controller for limited administrative, compliance and service-improvement purposes."],
  ["Fees and Payment", "Unless otherwise agreed in writing, invoices are payable within 7 days of the invoice date."],
  ["Liability", "Subject to applicable law, NZI's total aggregate liability for the relevant engagement shall not exceed the fees paid by the Client under that engagement in the 12 months preceding the event giving rise to the claim."],
  ["Governing Law", "The engagement is governed by the laws of England and Wales and subject to the exclusive jurisdiction of the courts of England and Wales."],
];

const portalTerms = [
  "The NZI website, client portal and application may be used only for lawful business purposes connected with NZI services.",
  "Users must keep account credentials secure, keep account information accurate and report suspected compromise promptly.",
  "Clients remain responsible for uploaded files, data, messages and other content, including ensuring such content is lawful and may be shared with NZI.",
  "NZI may suspend access for maintenance, upgrades, security reasons or where continued access creates legal, operational or security risk.",
  "Platform access is provided on an as-available basis and does not replace professional judgement, legal advice or formal assurance unless expressly agreed.",
];

const privacySections = [
  ["What we collect", "We may collect identity, contact, account, communications, project, technical and usage data when individuals use our website, portal, app or services."],
  ["How we use it", "We use personal data to deliver services, manage client relationships, provide support, maintain security, administer accounts, improve our systems and comply with legal obligations."],
  ["Legal bases", "Depending on the context, we rely on contract, legitimate interests, legal obligations and, where required, consent."],
  ["Sharing", "We may share personal data with employees, contractors, advisers, hosting and software providers, storage providers, email providers, regulators and authorities where appropriate."],
  ["Transfers and retention", "Where data is processed outside the UK, NZI uses appropriate safeguards. Personal data is retained only for as long as reasonably necessary for service delivery, compliance and record-keeping."],
  ["Individual rights", "Individuals may have rights of access, rectification, erasure, restriction, objection, portability and withdrawal of consent, subject to legal limitations."],
];

const cookieSections = [
  ["Strictly necessary cookies", "Used for authentication, session management, platform security and core functionality."],
  ["Preference cookies", "Used to remember settings and improve user experience."],
  ["Analytics cookies", "Used, where permitted, to understand how users interact with the website or portal and improve performance."],
  ["Consent", "Where non-essential cookies are used, NZI will request consent where required by law before setting them."],
];

type Props = {
  publicView?: boolean;
};

export default function LegalDocuments({ publicView = false }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>Legal Documents</h1>
            <p className="text-muted-foreground">
              Standard terms, portal terms, privacy and cookies for NZI services and platform use.
            </p>
          </div>
          {publicView ? (
            <div className="text-right text-sm text-muted-foreground">
              <div className="font-medium text-foreground">Net Zero International</div>
              <div>167-169 Great Portland Street</div>
              <div>London, W1W 5PF</div>
            </div>
          ) : (
            <Button variant="secondary" asChild>
              <Link href="/support">Back to Help</Link>
            </Button>
          )}
        </div>

        <div className="grid gap-6">
          <Card id="standard-terms">
            <CardHeader>
              <CardTitle>Standard Terms &amp; Conditions</CardTitle>
              <CardDescription>
                These terms govern NZI's professional services, including reporting, advisory, data and platform-supported engagements.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {termsSummary.map(([title, text]) => (
                <div key={title}>
                  <div className="font-medium">{title}</div>
                  <p className="text-muted-foreground">{text}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card id="portal-terms">
            <CardHeader>
              <CardTitle>Portal Terms of Use</CardTitle>
              <CardDescription>
                These terms govern access to and use of the NZI website, client portal and application.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {portalTerms.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </CardContent>
          </Card>

          <Card id="privacy-policy">
            <CardHeader>
              <CardTitle>Privacy Policy</CardTitle>
              <CardDescription>
                This policy explains how NZI collects, uses, stores and protects personal data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {privacySections.map(([title, text]) => (
                <div key={title}>
                  <div className="font-medium">{title}</div>
                  <p className="text-muted-foreground">{text}</p>
                </div>
              ))}
              <p className="text-muted-foreground">
                Questions or data rights requests can be sent to NZI at 167-169 Great Portland Street, London, W1W 5PF, United Kingdom, or via NZI's designated privacy contact.
              </p>
            </CardContent>
          </Card>

          <Card id="cookie-notice">
            <CardHeader>
              <CardTitle>Cookie Notice</CardTitle>
              <CardDescription>
                This notice explains how NZI uses cookies and similar technologies on its website and portal.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {cookieSections.map(([title, text]) => (
                <div key={title}>
                  <div className="font-medium">{title}</div>
                  <p className="text-muted-foreground">{text}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {publicView ? (
          <div className="mt-8 border-t pt-4 text-sm text-muted-foreground">
            Copyright Net Zero International
          </div>
        ) : null}
      </div>
    </div>
  );
}
