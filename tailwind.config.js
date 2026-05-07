/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0d10',
          900: '#11141a',
          800: '#171b22',
          700: '#1e2330',
          600: '#2a3040',
          500: '#3a4256',
          400: '#5b6478',
          300: '#8a93a6',
          200: '#c4cad6',
          100: '#e6e9f0',
        },
        accent: {
          500: '#5b8cff',
          600: '#3f73f0',
        },
      },
    },
  },
  plugins: [],
};
