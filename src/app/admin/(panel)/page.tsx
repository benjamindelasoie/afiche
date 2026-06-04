import { redirect } from 'next/navigation';

/**
 * /admin → /admin/unmatched. The panel's home is the operator's primary
 * workflow (assigning TMDB IDs to unmatched films).
 */
export default function AdminIndex() {
  redirect('/admin/unmatched');
}
