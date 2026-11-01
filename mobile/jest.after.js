// A cold transform cache makes the first run slow; findBy*/waitFor must not time out then.
require("@testing-library/react-native").configure({ asyncUtilTimeout: 5000 });
