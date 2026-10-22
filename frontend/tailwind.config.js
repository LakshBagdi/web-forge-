/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0e14',
        panel: '#121722',
        edge: '#1e2636',
        accent: '#5b8cff',
      },
    },
  },
  plugins: [],
};
