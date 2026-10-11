// Remove demo seed listings/wants from whatever DB .env points at (see src/maintenance/unseed.ts).
import { unseed } from "../src/maintenance/unseed";

await unseed();
process.exit(0);
