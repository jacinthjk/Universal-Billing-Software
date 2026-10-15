// Rule-based fallback provider: no LLM. Answers product questions from live catalogue data via the
// same controlled tools, captures contact details into leads, and hands off anything else.
const STOP = new Set('do you have any the a an is are of for in on to me i want need price cost how much available stock what about please can get some with and or my your this that is there name hi hello hey thanks thank yes ok okay sure'.split(' '));

const phoneRe = /(\+?\d[\d\s-]{8,}\d)/;
const emailRe = /([\w.+-]+@[\w-]+\.[\w.]+)/;
const nameRe = /(?:my name is|i am|i'm|this is)\s+([a-z][a-z ]{1,30}?)(?:[.,!]|$| and| my)/i;
const orderRe = /\b((?:ORD|QT)-\d{3,})\b/i;

function keywords(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

async function run({ userText, executeTool, business, transcript }) {
  const t = userText.trim();
  const phone = (t.match(phoneRe) || [])[1];
  const email = (t.match(emailRe) || [])[1];
  const name = (t.match(nameRe) || [])[1];
  const replies = [];
  let uncertain = false;

  if (/\b(human|agent|staff|person|call me|callback|call back|talk to someone)\b/i.test(t)) {
    await executeTool('handoff_to_staff', { reason: 'Customer asked for a human', summary: t.slice(0, 300) });
    return { text: 'Sure - I have asked a team member to take over. They will reply here shortly.' };
  }

  const ord = t.match(orderRe);
  if (ord) {
    if (!phone) return { text: `To check order ${ord[1].toUpperCase()}, please share the phone number used for the order.` };
    const { output } = await executeTool('get_order_status', { order_number: ord[1], phone });
    if (output.error) return { text: output.error };
    return { text: `Order ${output.order_number} is ${output.status.toLowerCase()} (payment: ${output.payment_status.toLowerCase()}). Track it here: ${output.tracking_url}` };
  }

  if (phone || email) {
    await executeTool('create_customer', { name: name || 'Website visitor', phone, email });
    const lastAsk = [...transcript].reverse().find((m) => m.role === 'user' && !phoneRe.test(m.text));
    await executeTool('create_enquiry', { intent: 'PRODUCT_ENQUIRY', name, phone, email, item_text: lastAsk?.text?.slice(0, 200), summary: `Customer shared contact details. Last question: ${lastAsk?.text || t}`.slice(0, 500), signals: ['callbackAsked'] });
    replies.push(`Thanks${name ? `, ${name.trim()}` : ''}! I've noted your details and our team will follow up.`);
  }

  const words = keywords(t.replace(phoneRe, '').replace(emailRe, '').replace(nameRe, ' '));
  const sharedContact = !!(phone || email);
  if ((words.length && !sharedContact) || (words.length > 1 && sharedContact)) {
    const { output } = await executeTool('search_products', { query: words.join(' '), limit: 3 });
    if (output.results?.length) {
      const lines = output.results.map((p) => `• ${p.name}${p.variant ? ` (${p.variant})` : ''} - ${business.currency === 'INR' ? '₹' : `${business.currency} `}${p.price.toFixed(2)}/${p.unit}, ${p.availability}. ${p.url}`);
      replies.push(`Here's what I found:\n${lines.join('\n')}`);
      if (!phone && !email) replies.push('Would you like to order? You can use the links above, or share your phone number and we will help you.');
    } else if (!replies.length) {
      const { output: info } = await executeTool('get_business_info', { topic: t });
      if (info.knowledge_base?.length) {
        replies.push(info.knowledge_base[0].answer);
      } else {
        uncertain = true;
        replies.push(`I couldn't find that in our catalogue. Share your phone number and a team member from ${business.name} will help you.`);
      }
    }
  }
  if (!replies.length) replies.push(business.ai.greeting || 'How can I help you today?');
  return { text: replies.join('\n\n'), uncertain };
}

module.exports = { name: 'rules', run };
