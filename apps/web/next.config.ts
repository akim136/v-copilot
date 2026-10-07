import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  transpilePackages: ['@v-copilot/poc-core'],
};

export default withWorkflow(nextConfig);
