(() => {
  window.HubMemberReturn = value => {
    if (!value) return null;

    try {
      const base = new URL('.', location.href);
      const url = new URL(value, base);

      if (
        url.origin !== base.origin ||
        url.pathname !== base.pathname + 'discussions.html' ||
        url.username ||
        url.password
      ) {
        return null;
      }

      const result = new URL('discussions.html', base);
      const thread = url.searchParams.get('thread');

      if (thread && /^[0-9a-f-]{36}$/i.test(thread)) {
        result.searchParams.set('thread', thread);
      }

      result.searchParams.set('join', '1');
      return result.href;
    } catch {
      return null;
    }
  };
})();
