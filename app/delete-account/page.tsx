import Link from "next/link";

export const metadata = {
  title: "Delete Your Account | Creovanta",
  description: "How to request permanent deletion of your Creovanta account and associated data.",
};

export default function DeleteAccountPage() {
  return (
    <main style={{maxWidth:760,margin:"0 auto",padding:"48px 22px",color:"#f4f6fb",lineHeight:1.75}}>
      <p style={{color:"#a997ff",letterSpacing:2,fontSize:12,fontWeight:700}}>CREOVANTA · ACCOUNT CONTROL</p>
      <h1 style={{fontSize:38,margin:"8px 0 12px"}}>Delete your Creovanta account</h1>
      <p>You can permanently delete your account and the personal data stored by Creovanta.</p>
      <ol>
        <li>Open the <Link href="/#account" style={{color:"#70d9e8"}}>Creovanta app</Link> and sign in with the account you want to delete.</li>
        <li>Scroll to <b>Account &amp; Privacy</b>.</li>
        <li>Choose <b>Delete my account</b> and confirm the permanent deletion.</li>
      </ol>
      <p>The deletion request removes your Creovanta account, voice profiles, consent records, and private uploaded voice samples. Generated audio saved only on your device is also cleared by the in-app deletion flow for that device.</p>
      <p>Copies previously sent to external speech providers may be retained under those providers' own policies. Creovanta cannot directly control their independent retention systems.</p>
      <p>If you cannot sign in, use the developer contact email shown on the Creovanta Google Play listing and include the account email address. Do not send passwords or voice recordings in a support request.</p>
      <p style={{marginTop:32}}><Link href="/" style={{color:"#70d9e8"}}>Back to Creovanta</Link> · <Link href="/privacy" style={{color:"#70d9e8"}}>Privacy Policy</Link></p>
    </main>
  );
}
