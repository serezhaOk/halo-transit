import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Client as NotionClient } from '@notionhq/client';
import { SYSTEM_PROMPT } from '@/lib/prompt';

type AllowedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function toAllowedMediaType(mimeType: string): AllowedMediaType {
  const allowed: AllowedMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowed.includes(mimeType as AllowedMediaType)) {
    return mimeType as AllowedMediaType;
  }
  return 'image/jpeg';
}

interface NotionRichText {
  text: { content: string };
}

interface NotionParagraphBlock {
  object: 'block';
  type: 'paragraph';
  paragraph: { rich_text: NotionRichText[] };
}

interface NotionHeading2Block {
  object: 'block';
  type: 'heading_2';
  heading_2: { rich_text: NotionRichText[] };
}

type NotionBlock = NotionParagraphBlock | NotionHeading2Block;

function descriptionToNotionBlocks(text: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  const chunks = text.split(/\n\n/);

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('## ')) {
      const heading = trimmed.replace(/^##\s*/, '');
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ text: { content: heading.slice(0, 2000) } }],
        },
      });
    } else {
      // Split long paragraphs into multiple paragraph blocks (Notion 2000 char limit)
      const lines = trimmed.split('\n');
      let current = '';

      for (const line of lines) {
        if (current.length + line.length + 1 > 1900) {
          if (current.trim()) {
            blocks.push({
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ text: { content: current.trim() } }],
              },
            });
          }
          current = line;
        } else {
          current = current ? `${current}\n${line}` : line;
        }
      }

      if (current.trim()) {
        // Handle remaining content that might still exceed 2000 chars
        const remaining = current.trim();
        if (remaining.length > 2000) {
          // Split into chunks of 2000 chars
          for (let i = 0; i < remaining.length; i += 2000) {
            blocks.push({
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ text: { content: remaining.slice(i, i + 2000) } }],
              },
            });
          }
        } else {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ text: { content: remaining } }],
            },
          });
        }
      }
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
      return NextResponse.json(
        { error: 'At least one image is required' },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is not configured' },
        { status: 500 }
      );
    }

    // Convert images to base64
    const imageBlocks: Anthropic.ImageBlockParam[] = await Promise.all(
      images.map(async (image) => {
        const buffer = await image.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mediaType = toAllowedMediaType(image.type);
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mediaType,
            data: base64,
          },
        };
      })
    );

    // Build message content
    const textContent = notes?.trim()
      ? `Seller's notes: ${notes.trim()}\n\nPlease create a complete Etsy listing for this vintage clothing item.`
      : 'Please create a complete Etsy listing for this vintage clothing item.';

    const messageContent: Anthropic.ContentBlockParam[] = [
      ...imageBlocks,
      {
        type: 'text',
        text: textContent,
      },
    ];

    // Call Claude
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageContent }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from Claude' },
        { status: 500 }
      );
    }

    const description = textBlock.text;

    // Parse title for Notion page name
    const titleMatch = description.match(/##\s*TITLE\s*\n([^\n]+)/);
    const title = titleMatch ? titleMatch[1].trim() : 'Vintage Clothing Listing';

    // Save to Notion (optional)
    let notionUrl: string | null = null;

    if (process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID) {
      try {
        const notion = new NotionClient({ auth: process.env.NOTION_TOKEN });
        const titleProperty = process.env.NOTION_TITLE_PROPERTY || 'Name';
        const notionBlocks = descriptionToNotionBlocks(description);

        const page = await notion.pages.create({
          parent: {
            database_id: process.env.NOTION_DATABASE_ID,
          },
          properties: {
            [titleProperty]: {
              title: [
                {
                  text: {
                    content: title.slice(0, 2000),
                  },
                },
              ],
            },
          },
          children: notionBlocks,
        });

        notionUrl = (page as { url?: string }).url ?? null;
      } catch (notionError) {
        // Notion save failed — continue and return description without notionUrl
        console.error('Notion save failed:', notionError);
        notionUrl = null;
      }
    }

    return NextResponse.json({ description, notionUrl });
  } catch (err) {
    console.error('Generate error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
