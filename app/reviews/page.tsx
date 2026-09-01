import { redirect } from "next/navigation";
import { ReviewWorkspace } from "@/components/reviews/review-workspace";
import { getOptionalAppUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const user = await getOptionalAppUser();

  if (!user) {
    redirect("/login");
  }

  return <ReviewWorkspace />;
}
