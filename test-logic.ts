
import { parsePdfBuffer } from './src/services/pdfParser';
import { computeMetrics } from './src/services/metrics';

async function test() {
  try {
    // Mock pdf-parse to return empty text
    const buffer = Buffer.from('dummy');
    
    // We need to mock pdf-parse behavior or use a real PDF.
    // Since we can't easily mock the library import here without a test runner,
    // let's just call the function and see what happens with a dummy buffer.
    // The real pdf-parse might throw or return empty text for invalid PDF.
    
    console.log('Testing parsePdfBuffer...');
    const parsed = await parsePdfBuffer(buffer, 'test.pdf');
    console.log('Parsed:', JSON.stringify(parsed, null, 2));
    
    console.log('Testing computeMetrics...');
    const metrics = computeMetrics(parsed);
    console.log('Metrics:', metrics);
    
  } catch (e: any) {
    console.log('Error caught:', e.message);
  }
}

test();
