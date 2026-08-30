import { EnquiryForm } from "../../components/EnquiryForm";

export default function ContactPage() {
  const shopName = process.env.NEXT_PUBLIC_SHOP_NAME || "Sai Communication";
  const address = process.env.NEXT_PUBLIC_SHOP_ADDRESS || "Main Road, Your City";
  const phone = process.env.NEXT_PUBLIC_SHOP_PHONE || "+91 90000 00000";

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">
          Get in <em>Touch</em>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          Visit the store, call us, or send an enquiry below — we&apos;ll get back to you within
          24 hours.
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          <div className="card-surface p-5">
            <h2 className="font-display font-medium text-foreground">{shopName}</h2>
            <p className="mt-2 text-sm text-muted-foreground">📍 {address}</p>
            <p className="mt-1 text-sm text-muted-foreground">📞 {phone}</p>
          </div>
          <div className="card-surface overflow-hidden">
            <iframe
              title="Store location"
              className="h-64 w-full border-0"
              loading="lazy"
              src={`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`}
            />
          </div>
        </div>
        <EnquiryForm />
      </div>
    </main>
  );
}
