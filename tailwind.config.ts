import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.ts',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
