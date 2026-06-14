import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Client as NotionClient } from '@notionhq/client';
import type { DatabaseObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { SYSTEM_PROMPT } from '@/lib/prompt';

type AllowedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function toAllowedMediaType(mimeType: string): AllowedMediaType {
  const allowed: AllowedMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  return allowed.includes(mimeType as AllowedMediaType)
    ? (mimeType as AllowedMediaType)
    : 'image/jpeg';
}

// Parse Claude's structured output into named sections
function parseSections(text: string): { title: string; description: string; tags: string[] } {
  const titleMatch = text.match(/##\s*TITLE\s*\n([\s\S]*?)(?=\n##|$)/i);
  const descMatch = text.match(/##\s*DESCRIPTION\s*\n([\s\S]*?)(?=\n##|$)/i);
  const tagsMatch = text.match(/##\s*TAGS\s*\n([\s\S]*?)(?=\n##|$)/i);

  const title = titleMatch ? titleMatch[1].trim() : 'Vintage Clothing Listing';
  const description = descMatch ? descMatch[1].trim() : text;
  const tagsRaw = tagsMatch ? tagsMatch[1].trim() : '';
  const tags = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  return { title, description, tags };
}

type NotionPropertySchema = DatabaseObjectResponse['properties'][string];

// Map a parsed section to the correct Notion property value based on property type
function buildPropertyValue(
  prop: NotionPropertySchema,
  title: string,
  description: string,
  tags: string[]
): Record<string, unknown> | null {
  const name = prop.name.toLowerCase();

  if (prop.type === 'title') {
    return { title: [{ text: { content: title.slice(0, 2000) } }] };
  }

  if (prop.type === 'rich_text') {
    if (name.includes('descri') || name.includes('text') || name.includes('body')) {
      return { rich_text: [{ text: { content: description.slice(0, 2000) } }] };
    }
    if (name.includes('tag') || name.includes('keyword')) {
      return { rich_text: [{ text: { content: tags.join(', ').slice(0, 2000) } }] };
    }
  }

  if (prop.type === 'multi_select' && (name.includes('tag') || name.includes('keyword'))) {
    return {
      multi_select: tags.map((t) => ({ name: t.slice(0, 100) })),
    };
  }

  return null;
}

async function saveToNotion(
  notion: NotionClient,
  databaseId: string,
  fullText: string,
  title: string,
  description: string,
  tags: string[]
): Promise<string | null> {
  // Discover actual database properties so we fill the right columns
  const database = (await notion.databases.retrieve({
    database_id: databaseId,
  })) as DatabaseObjectResponse;

  const builtProperties: Record<string, unknown> = {};
  for (const prop of Object.values(database.properties)) {
    const value = buildPropertyValue(prop, title, description, tags);
    if (value !== null) {
      builtProperties[prop.name] = value;
    }
  }

  // Content blocks: full Claude response (all sections)
  const blocks = buildContentBlocks(fullText);

  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: builtProperties as Parameters<typeof notion.pages.create>[0]['properties'],
    children: blocks,
  });

  return (page as { url?: string }).url ?? null;
}

interface RichText {
  text: { content: string };
}
interface ParagraphBlock {
  object: 'block';
  type: 'paragraph';
  paragraph: { rich_text: RichText[] };
}
interface Heading2Block {
  object: 'block';
  type: 'heading_2';
  heading_2: { rich_text: RichText[] };
}
type ContentBlock = ParagraphBlock | Heading2Block;

function buildContentBlocks(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const chunk of text.split(/\n\n/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ text: { content: trimmed.replace(/^##\s*/, '').slice(0, 2000) } }],
        },
      });
      continue;
    }

    // Paragraph — split at 1900 chars to stay under Notion's 2000-char limit
    let remaining = trimmed;
    while (remaining.length > 0) {
      const slice = remaining.slice(0, 1900);
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: slice } }] },
      });
      remaining = remaining.slice(1900);
    }
  }

  return blocks;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const images = formData.getAll('images') as File[];
    const notes = formData.get('notes') as string;

    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'At least one image is required' }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 });
    }

    const imageBlocks: Anthropic.ImageBlockParam[] = await Promise.all(
      images.map(async (image) => {
        const buffer = await image.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: toAllowedMediaType(image.type),
            data: base64,
          },
        };
      })
    );

    const textPrompt = notes?.trim()
      ? `Seller's notes: ${notes.trim()}\n\nPlease create a complete Etsy listing for this vintage clothing item.`
      : 'Please create a complete Etsy listing for this vintage clothing item.';

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [...imageBlocks, { type: 'text', text: textPrompt }],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No text response from Claude' }, { status: 500 });
    }

    const fullText = textBlock.text;
    const { title, description, tags } = parseSections(fullText);

    let notionUrl: string | null = null;
    if (process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID) {
      try {
        const notion = new NotionClient({ auth: process.env.NOTION_TOKEN });
        notionUrl = await saveToNotion(
          notion,
          process.env.NOTION_DATABASE_ID,
          fullText,
          title,
          description,
          tags
        );
      } catch (notionError) {
        console.error('Notion save failed:', notionError);
      }
    }

    return NextResponse.json({ description: fullText, notionUrl });
  } catch (err) {
    console.error('Generate error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
