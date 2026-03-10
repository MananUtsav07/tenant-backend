import { AppError } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
function throwIfError(error, message) {
    if (error) {
        throw new AppError(message, 500, error.message);
    }
}
function escapeSearchTerm(term) {
    return term.replace(/[%_]/g, '').replaceAll(',', ' ').trim();
}
const blogSelectFields = 'id, title, slug, content, excerpt, cover_image, author, published, created_at, updated_at';
export async function listBlogPosts(query) {
    const from = (query.page - 1) * query.page_size;
    const to = from + query.page_size - 1;
    let request = supabaseAdmin
        .from('blog_posts')
        .select(blogSelectFields, { count: 'exact' })
        .order(query.sort_by, { ascending: query.sort_order === 'asc' })
        .range(from, to);
    if (!query.include_unpublished) {
        request = request.eq('published', true);
    }
    if (query.search && query.search.trim().length > 0) {
        const escaped = escapeSearchTerm(query.search);
        if (escaped.length > 0) {
            request = request.or(`title.ilike.%${escaped}%,excerpt.ilike.%${escaped}%,author.ilike.%${escaped}%`);
        }
    }
    const { data, error, count } = await request;
    throwIfError(error, 'Failed to list blog posts');
    return {
        items: data ?? [],
        total: count ?? 0,
    };
}
export async function getPublishedBlogPostBySlug(slug) {
    const { data, error } = await supabaseAdmin
        .from('blog_posts')
        .select(blogSelectFields)
        .eq('slug', slug)
        .eq('published', true)
        .maybeSingle();
    throwIfError(error, 'Failed to load blog post');
    return data;
}
export async function createBlogPost(input) {
    const { data, error } = await supabaseAdmin
        .from('blog_posts')
        .insert({
        title: input.title,
        slug: input.slug,
        content: input.content,
        excerpt: input.excerpt,
        cover_image: input.cover_image ?? null,
        author: input.author ?? 'TenantFlow Team',
        published: input.published ?? false,
    })
        .select(blogSelectFields)
        .single();
    throwIfError(error, 'Failed to create blog post');
    if (!data) {
        throw new AppError('Failed to create blog post', 500);
    }
    return data;
}
export async function updateBlogPost(blogPostId, patch) {
    const { data, error } = await supabaseAdmin
        .from('blog_posts')
        .update(patch)
        .eq('id', blogPostId)
        .select(blogSelectFields)
        .maybeSingle();
    throwIfError(error, 'Failed to update blog post');
    return data;
}
export async function deleteBlogPost(blogPostId) {
    const { error, count } = await supabaseAdmin.from('blog_posts').delete({ count: 'exact' }).eq('id', blogPostId);
    throwIfError(error, 'Failed to delete blog post');
    return count ?? 0;
}
//# sourceMappingURL=blogService.js.map