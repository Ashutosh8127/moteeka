/**
 * How the Firestore client is told who it is, in each place it can run.
 *
 * There are three, and only one of them has a filesystem to keep a key on:
 *
 *   - **your laptop** — GOOGLE_APPLICATION_CREDENTIALS points at the JSON file
 *     in ~/.config/moteeka. Nothing here is needed; the client finds it.
 *   - **a Google host** (Cloud Run, App Hosting) — the container carries its
 *     own identity. Again nothing here is needed, and there is no key to leak.
 *   - **anywhere else** (Vercel, Render, Fly) — no file and no identity, so the
 *     key travels as FIREBASE_SERVICE_ACCOUNT: the downloaded JSON, verbatim.
 *
 * The private key is the awkward part. Dashboards that store secrets as single
 * lines turn its newlines into a literal backslash-n, and a PEM whose newlines
 * are two characters instead of one fails to parse with an error that names
 * neither the cause nor this file. Both spellings are accepted.
 */
export interface FirestoreOptions {
  projectId?: string;
  ignoreUndefinedProperties: boolean;
  credentials?: { client_email: string; private_key: string };
}

export function firestoreOptions(): FirestoreOptions {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID;
  const base = { projectId, ignoreUndefinedProperties: true };

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw?.trim()) return base;

  let key: { client_email?: string; private_key?: string; project_id?: string };
  try {
    key = JSON.parse(raw);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is set but is not JSON. Paste the whole ' +
      'service account file, including the outer { }.',
    );
  }
  if (!key.client_email || !key.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key.');
  }

  return {
    ...base,
    projectId: projectId || key.project_id,
    credentials: {
      client_email: key.client_email,
      private_key: key.private_key.replace(/\\n/g, '\n'),
    },
  };
}
