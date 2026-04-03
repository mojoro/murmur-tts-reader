from orchestrator.sentence_splitter import split_sentences


def test_simple_sentences():
    assert split_sentences("Hello world. How are you?") == ["Hello world.", "How are you?"]


def test_abbreviations():
    assert split_sentences("Dr. Smith went home.") == ["Dr. Smith went home."]


def test_initials():
    assert split_sentences("J. K. Rowling wrote books.") == ["J. K. Rowling wrote books."]


def test_decimals():
    assert split_sentences("The value is 3.14. That is pi.") == ["The value is 3.14.", "That is pi."]


def test_empty():
    assert split_sentences("") == []


def test_no_punctuation():
    assert split_sentences("Just a fragment") == ["Just a fragment"]
