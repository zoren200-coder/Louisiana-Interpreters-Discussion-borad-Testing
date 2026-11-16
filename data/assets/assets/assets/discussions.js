(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const status = $('discussion-status');
  const config = window.HUB_SUPABASE_DIRECTORY;

  if (!config || !window.supabase?.createClient) {
    status.textContent =
      'Discussion service unavailable. Please reload and try again.';
    return;
  }

  const client = window.supabase.createClient(
    config.url,
    config.publishableKey
  );

  let user = null;
  let member = false;
  let moderator = false;
  let records = [];
  let busy = false;
  let composeFocused = false;

  const parameters = new URLSearchParams(location.search);
  const destination = window.HubMemberReturn(location.href);
  const signin = new URL('membership.html', location.href);

  signin.searchParams.set('next', destination);
  $('discussion-signin').href = signin.href;

  function element(tag, text, className) {
    const node = document.createElement(tag);

    if (text !== undefined) {
      node.textContent = text;
    }

    if (className) {
      node.className = className;
    }

    return node;
  }

  function button(label, action) {
    const node = element('button', label, 'button');
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function focusComposer() {
    $('discussion-compose').scrollIntoView({
      block: 'start',
      behavior: 'instant'
    });

    $('discussion-title').focus({
      preventScroll: true
    });
  }

  $('discussion-start').addEventListener('click', () => {
    if (member) {
      focusComposer();
    } else {
      location.assign(signin.href);
    }
  });

  function showAuth() {
    $('discussion-auth').textContent = member
      ? moderator
        ? 'Signed in as a Hub moderator.'
        : 'Signed in with your Hub membership account.'
      : 'You can read public discussions. Sign in with a confirmed Hub account to participate.';

    $('discussion-signin').hidden = member;
    $('discussion-signout').hidden = !user;
    $('discussion-compose').hidden = !member;
  }

  async function mutate(action, successMessage) {
    if (busy) return false;

    busy = true;

    document.querySelectorAll('.discussion-page button')
      .forEach(node => {
        node.disabled = true;
      });

    try {
      const result = await action();

      if (result.error) {
        throw result.error;
      }

      if (
        Array.isArray(result.data) &&
        result.data.length === 0
      ) {
        throw new Error('No permitted row was changed.');
      }

      await loadPosts();
      status.textContent = successMessage;
      return true;
    } catch {
      status.textContent =
        'This change could not be saved. Check your connection and permissions, then refresh and try again.';
      return false;
    } finally {
      busy = false;

      document.querySelectorAll('.discussion-page button')
        .forEach(node => {
          node.disabled = false;
        });
    }
  }

  function openEditor(post, container) {
    const form = element('form');
    form.setAttribute('aria-label', 'Edit your post');

    let titleInput;

    if (!post.thread_id) {
      const titleLabel = element('label', 'Title');
      titleInput = element('input');
      titleInput.required = true;
      titleInput.maxLength = 200;
      titleInput.value = post.title;

      titleLabel.append(titleInput);
      form.append(titleLabel);
    }

    const bodyLabel = element('label', 'Post text');
    const bodyInput = element('textarea');

    bodyInput.required = true;
    bodyInput.maxLength = 12000;
    bodyInput.rows = 5;
    bodyInput.value = post.body;

    bodyLabel.append(bodyInput);
    form.append(bodyLabel);

    const save = element('button', 'Save changes', 'button');
    save.type = 'submit';

    form.append(
      save,
      button('Cancel', () => form.remove())
    );

    form.addEventListener('submit', async event => {
      event.preventDefault();

      if (
        !form.reportValidity() ||
        !bodyInput.value.trim() ||
        (titleInput && !titleInput.value.trim())
      ) {
        return;
      }

      const changes = {
        body: bodyInput.value.trim()
      };

      if (titleInput) {
        changes.title = titleInput.value.trim();
      }

      await mutate(
        () => client
          .from('discussion_posts')
          .update(changes)
          .eq('id', post.id)
          .select('id'),
        'Your post has been updated.'
      );
    });

    container.append(form);
    bodyInput.focus();
  }

  function postContent(post, parent) {
    const box = element(
      post.thread_id ? 'div' : 'article',
      undefined,
      post.thread_id
        ? 'discussion-reply'
        : 'discussion-post'
    );

    box.id = 'post-' + post.id;

    if (post.title) {
      box.append(element('h2', post.title));
    }

    const date = new Date(post.created_at).toLocaleString();

    box.append(
      element(
        'p',
        'Member ' +
          post.author_id.slice(0, 8) +
          ' · ' +
          date +
          (post.hidden ? ' · Hidden' : ''),
        'discussion-byline'
      ),
      element('p', post.body, 'discussion-text')
    );

    const controls = element(
      'div',
      undefined,
      'discussion-controls'
    );

    if (
      member &&
      post.author_id === user.id &&
      !post.hidden &&
      !parent.locked &&
      !parent.hidden
    ) {
      controls.append(
        button('Edit your post', () => {
          const existing = box.querySelector(
            'form[aria-label="Edit your post"]'
          );

          if (!existing) {
            openEditor(post, box);
          }
        })
      );
    }

    if (moderator) {
      controls.append(
        button(
          post.hidden ? 'Restore post' : 'Hide post',
          () => mutate(
            () => client.rpc('discussion_moderate', {
              post_id: post.id,
              hide_post: !post.hidden,
              lock_thread: post.locked
            }),
            'Moderation change saved.'
          )
        )
      );

      if (!post.thread_id) {
        controls.append(
          button(
            post.locked ? 'Unlock thread' : 'Lock thread',
            () => mutate(
              () => client.rpc('discussion_moderate', {
                post_id: post.id,
                hide_post: post.hidden,
                lock_thread: !post.locked
              }),
              'Moderation change saved.'
            )
          )
        );
      }
    }

    if (controls.children.length) {
      box.append(controls);
    }

    return box;
  }

  function render() {
    const list = $('discussion-list');
    list.replaceChildren();

    const threads = records.filter(post => !post.thread_id);

    for (const thread of threads) {
      const article = postContent(thread, thread);

      if (thread.locked) {
        article.append(
          element('p', 'This discussion is locked.')
        );
      }

      const replies = records.filter(
        post => post.thread_id === thread.id
      );

      for (const reply of replies) {
        article.append(postContent(reply, thread));
      }

      if (member && !thread.locked && !thread.hidden) {
        const form = element('form');

        form.setAttribute(
          'aria-label',
          'Reply to ' + thread.title
        );

        const label = element('label', 'Your reply');
        const input = element('textarea');

        input.required = true;
        input.maxLength = 12000;
        input.rows = 3;

        label.append(input);
        form.append(label);

        const submit = element(
          'button',
          'Post reply',
          'button'
        );

        submit.type = 'submit';
        form.append(submit);

        form.addEventListener('submit', async event => {
          event.preventDefault();

          if (
            !form.reportValidity() ||
            !input.value.trim()
          ) {
            return;
          }

          await mutate(
            () => client
              .from('discussion_posts')
              .insert({
                thread_id: thread.id,
                author_id: user.id,
                body: input.value.trim()
              })
              .select('id'),
            'Your reply has been posted.'
          );
        });

        article.append(form);
      }

      list.append(article);
    }

    $('discussion-empty').hidden = threads.length > 0;
  }

  async function loadPosts() {
    const all = [];

    for (let offset = 0; ;) {
      const { data, error } = await client
        .from('discussion_posts')
        .select(
          'id,thread_id,author_id,title,body,hidden,locked,created_at,updated_at'
        )
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + 499);

      if (error || !Array.isArray(data)) {
        throw error || new Error('Invalid response.');
      }

      if (data.length === 0) {
        break;
      }

      all.push(...data);
      offset += data.length;
    }

    records = all;
    render();

    status.textContent = 'Discussions are up to date.';

    if (
      member &&
      parameters.get('join') === '1' &&
      !composeFocused
    ) {
      composeFocused = true;
      requestAnimationFrame(focusComposer);
    }
  }

  async function refresh() {
    status.textContent = 'Loading discussions…';
    $('discussion-empty').hidden = true;

    try {
      const { data, error } = await client.auth.getSession();

      if (error) {
        throw error;
      }

      user = data.session?.user || null;
      member = false;
      moderator = false;

      if (!user && parameters.get('join') === '1') {
        location.replace(signin.href);
        return;
      }

      if (user) {
        const access = await client.rpc(
          'discussion_is_member'
        );

        if (access.error) {
          throw access.error;
        }

        member = access.data === true;

        const moderation = await client.rpc(
          'discussion_is_moderator'
        );

        if (moderation.error) {
          throw moderation.error;
        }

        moderator = moderation.data === true;
      }

      showAuth();
      await loadPosts();
    } catch {
      showAuth();

      status.textContent =
        'The discussion board is unavailable. Check the Supabase connection, migration, and permissions.';
    }
  }

  $('discussion-form').addEventListener(
    'submit',
    async event => {
      event.preventDefault();

      const form = event.currentTarget;

      if (!member || !form.reportValidity()) {
        return;
      }

      const title = $('discussion-title').value.trim();
      const body = $('discussion-body').value.trim();

      if (!title || !body) {
        return;
      }

      const saved = await mutate(
        () => client
          .from('discussion_posts')
          .insert({
            author_id: user.id,
            title,
            body
          })
          .select('id'),
        'Your discussion has been posted.'
      );

      if (saved) {
        form.reset();
      }
    }
  );

  $('discussion-refresh').addEventListener(
    'click',
    refresh
  );

  $('discussion-signout').addEventListener(
    'click',
    async () => {
      const { error } = await client.auth.signOut();

      if (error) {
        status.textContent =
          'Could not sign out. Please try again.';
        return;
      }

      user = null;
      member = false;
      moderator = false;

      showAuth();

      try {
        await loadPosts();
      } catch {
        status.textContent =
          'Signed out. Discussions could not be refreshed.';
      }
    }
  );

  client.auth.onAuthStateChange(event => {
    if (
      ['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED']
        .includes(event)
    ) {
      setTimeout(refresh, 0);
    }
  });

  $('year').textContent = new Date().getFullYear();

  refresh();
})();
