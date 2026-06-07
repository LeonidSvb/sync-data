from supabase.sync_campaigns import sync as sync_campaigns
from supabase.sync_threads import sync as sync_threads

print("=== PlusVibe -> Supabase sync ===\n")

sync_campaigns()
print()
sync_threads()

print("\n=== Done ===")
